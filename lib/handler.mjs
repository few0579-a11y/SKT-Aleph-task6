// API 로직. Vercel 함수(api/router.js)와 로컬 서버(server.mjs)가 함께 쓴다.
import postgres from 'postgres';

let sql;
function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(500, 'DATABASE_URL이 설정되지 않았습니다');
    sql = postgres(url, {
      prepare: false, // Supabase transaction pooler 호환
      max: 3,
      idle_timeout: 20,
      types: {
        bigint: postgres.BigInt,
        // date는 시간대 변환 없이 'YYYY-MM-DD' 문자열 그대로 주고받는다
        date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x },
      },
    });
  }
  return sql;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------- 입력 검증 ----------
const PRIORITIES = ['high', 'medium', 'low'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v, name, max) {
  if (typeof v !== 'string' || v.trim() === '') throw new HttpError(400, `${name}은(는) 필수입니다`);
  const s = v.trim();
  if (s.length > max) throw new HttpError(400, `${name}은(는) ${max}자 이하입니다`);
  return s;
}
function date(v, name) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) throw new HttpError(400, `${name}은(는) YYYY-MM-DD 형식입니다`);
  const d = new Date(v + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, `${name}이(가) 없는 날짜입니다`);
  return v;
}
function minutes(v, name) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new HttpError(400, `${name}은(는) 0 이상의 정수(분)입니다`);
  return n;
}
function priority(v) {
  if (!PRIORITIES.includes(v)) throw new HttpError(400, '우선순위는 high/medium/low 중 하나입니다');
  return v;
}
function id(v, name = 'id') {
  if (!/^\d{1,18}$/.test(String(v ?? ''))) throw new HttpError(400, `${name}이(가) 올바르지 않습니다`);
  return String(v);
}

// partial=true면 들어온 항목만 검사(수정용)
function planInput(b, partial = false) {
  const o = {};
  const has = (k) => !partial || b[k] !== undefined;
  if (has('title')) o.title = text(b.title, '제목', 200);
  if (has('period_start')) o.period_start = date(b.period_start, '시작일');
  if (has('period_end')) o.period_end = date(b.period_end, '종료일');
  if (has('priority')) o.priority = priority(b.priority);
  if (has('success_criteria')) o.success_criteria = text(b.success_criteria, '성공 기준', 1000);
  if (has('estimated_minutes')) o.estimated_minutes = minutes(b.estimated_minutes, '예상 시간');
  return o;
}

async function getPlan(s, pid) {
  const [p] = await s`select * from plans where id = ${pid}`;
  if (!p) throw new HttpError(404, '계획을 찾을 수 없습니다');
  return p;
}

// ---------- 라우팅 ----------
export async function handle({ method, path, body = {} }) {
  const s = db();
  const [res, rid, sub] = path.replace(/^\/?(api\/)?/, '').split('/').filter(Boolean);
  const M = method.toUpperCase();

  if (res === 'health' && M === 'GET') {
    const [{ now }] = await s`select now()`;
    return { status: 200, body: { ok: true, db_time: now } };
  }

  if (res === 'plans') {
    if (!rid && M === 'GET') {
      const plans = await s`select * from plans order by period_start desc, id desc`;
      return { status: 200, body: { plans } };
    }
    if (!rid && M === 'POST') {
      const o = planInput(body);
      if (o.period_end < o.period_start) throw new HttpError(400, '종료일은 시작일과 같거나 이후여야 합니다');
      const [plan] = await s`insert into plans ${s(o)} returning *`;
      return { status: 201, body: { plan } };
    }

    const pid = id(rid);
    if (!sub && M === 'GET') return { status: 200, body: { plan: await getPlan(s, pid) } };

    if (!sub && M === 'PATCH') {
      const cur = await getPlan(s, pid);
      const o = planInput(body, true);
      const merged = { ...cur, ...o };
      if (merged.period_end < merged.period_start) throw new HttpError(400, '종료일은 시작일과 같거나 이후여야 합니다');
      // 실제로 바뀐 항목만 반영. 아무것도 안 바뀌면 새 버전을 만들지 않는다.
      const changed = Object.fromEntries(Object.entries(o).filter(([k, v]) => String(v) !== String(cur[k])));
      if (!Object.keys(changed).length) return { status: 200, body: { plan: cur, changed: false } };
      const [plan] = await s`update plans set ${s(changed)} where id = ${pid} returning *`;
      return { status: 200, body: { plan, changed: true } };
    }

    if (sub === 'revisions' && M === 'GET') {
      await getPlan(s, pid);
      const revisions = await s`select * from plan_revisions where plan_id = ${pid} order by revision asc`;
      return { status: 200, body: { revisions } };
    }
  }

  throw new HttpError(404, '없는 경로입니다');
}

// bigint는 문자열로 직렬화
export function toJSON(obj) {
  return JSON.stringify(obj, (k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

export async function respond(req) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  try {
    const r = await handle(req);
    return { status: r.status, headers: { ...headers, ...(r.headers || {}) }, body: toJSON(r.body) };
  } catch (e) {
    // DB 제약 위반(23514)·형식 오류(22P02)는 400, 그 밖의 내부 오류는 내용을 숨긴다
    const status = e instanceof HttpError ? e.status : ['22P02', '23514', '22007', '22008'].includes(e.code) ? 400 : 500;
    const message = e instanceof HttpError ? e.message : status === 400 ? '입력값이 올바르지 않습니다' : '서버 오류가 발생했습니다';
    if (status === 500) console.error(e);
    return { status, headers, body: toJSON({ error: message }) };
  }
}
