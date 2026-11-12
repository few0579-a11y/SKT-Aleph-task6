// Vercel 서버 함수: /api/* 요청을 모두 받아 lib/handler.mjs로 넘긴다.
import { respond } from '../lib/handler.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('__path') ?? url.pathname.replace(/^\/api\/?/, '');
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
  const r = await respond({ method: req.method, path, body: body || {} });
  res.status(r.status);
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.send(r.body);
}
