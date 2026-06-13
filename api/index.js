let data = '暂无内容';

export default async function handler(req, res) {
  if (req.method === 'POST' && req.query.text) {
    data = req.query.text;
    return res.json({ ok: true });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ text: data });
}
