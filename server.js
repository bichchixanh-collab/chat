// Chạy local không cần Vercel CLI:  node server.js  -> http://localhost:3000
// Chỉ dùng module native của Node (không cần npm install).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(res, file) {
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  res.setHeader('Content-Type', MIME[path.extname(file)] || 'text/plain; charset=utf-8');
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.replace('/api/', '').replace(/[^a-z]/g, '') || 'messages';
      const handlerFile = path.join(ROOT, 'api', name + '.js');
      if (!fs.existsSync(handlerFile)) {
        res.statusCode = 404; res.end(JSON.stringify({ ok: false, error: 'API not found' }));
        return;
      }
      delete require.cache[require.resolve(handlerFile)];
      const handler = require(handlerFile);
      // giả lập res Express tối thiểu cho handler Vercel
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
      await handler(req, res);
      return;
    }
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    if (!file.startsWith(ROOT)) { res.statusCode = 403; res.end('Forbidden'); return; }
    if (!serveFile(res, file)) { res.statusCode = 404; res.end('Not found'); }
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`WAP CHAT local: http://localhost:${PORT}`));
