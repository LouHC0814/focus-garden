const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

function createServer(root = path.resolve(__dirname, '../dist')) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  return http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      const data = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 400); response.end('Not found'); }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8765);
  createServer().listen(port, '127.0.0.1', () => console.log(`像素专注花园：http://127.0.0.1:${port}`));
}
module.exports = { createServer };
