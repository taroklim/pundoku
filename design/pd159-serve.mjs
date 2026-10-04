// PD-159: статический сервер сборки + заглушка GET /api/daily/:date (sudoku.com, medium). node design/pd159-serve.mjs <dist> <port>
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [root, port] = [process.argv[2], +process.argv[3]];
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.webmanifest':'application/manifest+json', '.ico':'image/x-icon', '.woff2':'font/woff2' };
http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/); if (m && q.method === 'GET') { r.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); return r.end(JSON.stringify({ date: m[1], mission: '530070000600195000098000060800060003400803001700020006060000280000419005000080079', difficulty: 'medium', source: 'sudoku.com', winRate: 71 })); }
  if (u.startsWith('/api/')) { r.writeHead(503); return r.end(); }
  if (u === '/health') { r.writeHead(200, {'content-type':'text/plain'}); return r.end('ok'); }
  let f = path.join(root, u); if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  r.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
}).listen(port, '127.0.0.1');
