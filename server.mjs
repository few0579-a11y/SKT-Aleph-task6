// 로컬 실행용 서버: DATABASE_URL=... node server.mjs  (기본 포트 3000)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { respond } from './lib/handler.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const port = Number(process.env.PORT || 3000);
// LOCAL_SERIAL=1: API 요청을 하나씩 처리한다. 연결 하나에 세션 하나만 지원하는 로컬 테스트 DB(PGlite)용.
let queue = Promise.resolve();
const serial = (fn) => (process.env.LOCAL_SERIAL ? (queue = queue.then(fn, fn)) : fn());

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const c of req) raw += c;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    const r = await serial(() => respond({ method: req.method, path: url.pathname.slice(5), query: Object.fromEntries(url.searchParams), body }));
    res.writeHead(r.status, r.headers).end(r.body);
    return;
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([/\\]*\.\.[/\\])+/, '');
  try {
    const data = await readFile(join(process.cwd(), 'public', rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end('not found'); }
}).listen(port, () => console.log(`http://localhost:${port}`));
