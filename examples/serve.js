// Minimal static server for the browser demo: node examples/serve.js [port] -> /examples/browser.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp' };
const port = Number(process.argv[2] ?? 5178);
createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/') path = '/examples/browser.html';
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${port} is already in use (is the demo already running? try http://localhost:${port}/), or pass another port: node examples/serve.js ${port + 1}`);
  process.exit(1);
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/`)); // local only: it's a dev demo
