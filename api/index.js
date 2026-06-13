export const config = {
  runtime: 'edge', // 用 Edge Runtime，冷启动更快
};

// 简单限流：内存存储（生产环境建议用 Redis/Upstash）
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 60秒
const RATE_LIMIT_MAX = 30; // 每分钟最多30次

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimit.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  record.count++;
  rateLimit.set(ip, record);
  return true;
}

// 输入校验
function validateText(text) {
  if (typeof text !== 'string') return false;
  if (text.length === 0) return false;
  if (text.length > 10000) return false; // 最多1万字
  // 可选：过滤危险字符
  if (/[<>{}()[\]\\|`]/.test(text)) return false;
  return true;
}

export default async function handler(req, res) {
  // ========== 跨域头 ==========
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // 预检请求直接返回
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  
  // ========== 限流检查 ==========
  const ip = req.headers.get('x-forwarded-for') || req.socket.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ 
      error: '请求太频繁，请稍后再试',
      retryAfter: Math.ceil((rateLimit.get(ip).resetAt - Date.now()) / 1000)
    });
  }
  
  // ========== 路由分发 ==========
  const { searchParams } = new URL(req.url, `https://${req.headers.host}`);
  const action = searchParams.get('action') || 'get';
  const text = searchParams.get('text');
  const key = searchParams.get('key') || 'default'; // 支持多条数据
  
  try {
    switch (action) {
      
      // ---------- 写入 ----------
      case 'set':
        if (!validateText(text)) {
          return res.status(400).json({ error: '文本无效：长度1-10000字符，不含特殊字符' });
        }
        await KV.set(`msg:${key}`, text, { expirationTtl: 86400 * 30 }); // 存30天
        return res.json({ 
          ok: true, 
          message: '写入成功',
          key,
          expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
        });
      
      // ---------- 读取 ----------
      case 'get':
      case '':
        const data = await KV.get(`msg:${key}`) || null;
        if (!data) {
          return res.status(404).json({ error: '暂无内容', key });
        }
        return res.json({ 
          ok: true, 
          key,
          text: data,
          expiresAt: new Date(Date.now() + 86400000 * 30).toISOString()
        });
      
      // ---------- 删除 ----------
      case 'delete':
        await KV.delete(`msg:${key}`);
        return res.json({ ok: true, message: '已删除', key });
      
      // ---------- 列出所有key ----------
      case 'list':
        const keys = await KV.list({ prefix: 'msg:' });
        const list = keys.keys.map(k => ({
          key: k.name.replace('msg:', ''),
          ...(await KV.get(k.name) ? { hasData: true } : { hasData: false })
        }));
        return res.json({ ok: true, count: list.length, list });
      
      default:
        return res.status(400).json({ error: '未知操作', action });
    }
    
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: '服务器内部错误', detail: err.message });
  }
}