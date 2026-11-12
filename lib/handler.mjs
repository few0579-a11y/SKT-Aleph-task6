// API 로직. Vercel 함수(api/router.js)와 로컬 서버(server.mjs)가 함께 쓴다.
import postgres from 'postgres';

let sql;
function db() {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new HttpError(500, 'DATABASE_URL이 설정되지 않았습니다');
    sql = postgres(url, {
      prepare: false, // Supabase transaction pooler 호환
      max: Number(process.env.PG_POOL_MAX) || 3, // 로컬 테스트 DB(PGlite)는 1로 실행
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

// 태그: 배열 또는 "a, b" 문자열 → 앞뒤 공백 제거, 빈 값·중복 제거
function tags(v) {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v) && typeof v !== 'string') throw new HttpError(400, '태그 형식이 올바르지 않습니다');
  const list = (Array.isArray(v) ? v : v.split(',')).map((t) => String(t).trim()).filter(Boolean);
  const out = [...new Set(list)];
  if (out.length > 10 || out.some((t) => t.length > 30)) throw new HttpError(400, '태그는 10개까지, 각 30자 이하입니다');
  return out;
}

function taskInput(b, partial = false) {
  const o = {};
  const has = (k) => !partial || b[k] !== undefined;
  if (has('title')) o.title = text(b.title, '할 일', 200);
  if (has('due_date')) o.due_date = date(b.due_date, '마감일');
  if (has('priority')) o.priority = priority(b.priority);
  if (has('tags')) o.tags = tags(b.tags);
  if (has('estimated_minutes')) o.estimated_minutes = minutes(b.estimated_minutes, '예상 시간');
  return o;
}

function checkDueInPlan(due, plan) {
  if (due < plan.period_start || due > plan.period_end) {
    throw new HttpError(400, `마감일은 계획 기간(${plan.period_start} ~ ${plan.period_end}) 안이어야 합니다`);
  }
}

// 정렬 기준. 어떤 기준이든 마지막에 id 오름차순을 붙여 같은 값끼리도 순서가 항상 같다.
// col은 쿼리 조각을 만드는 함수라 사용자 입력이 SQL에 섞이지 않는다.
const SORTS = {
  due_date: { col: (s) => s`due_date`, label: '마감일' },
  priority: { col: (s) => s`case priority when 'high' then 1 when 'medium' then 2 else 3 end`, label: '우선순위', dirLabel: { asc: '높은 순', desc: '낮은 순' } },
  estimated_minutes: { col: (s) => s`estimated_minutes`, label: '예상 시간' },
  created_at: { col: (s) => s`created_at`, label: '등록 시각' },
  title: { col: (s) => s`title`, label: '제목' },
};

async function listTasks(s, q) {
  const pid = id(q.plan_id, 'plan_id');
  const key = SORTS[q.sort] ? q.sort : 'due_date';
  const dir = q.dir === 'desc' ? 'desc' : 'asc';
  const conds = [s`plan_id = ${pid}`, s`deleted_at is null`];
  const term = typeof q.q === 'string' ? q.q.trim() : '';
  if (term) {
    const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
    conds.push(s`(title ilike ${like} or ${term} = any(tags))`);
  }
  if (q.status === 'open' || q.status === 'done') conds.push(s`status = ${q.status}`);
  if (PRIORITIES.includes(q.priority)) conds.push(s`priority = ${q.priority}`);
  const where = conds.reduce((a, c) => s`${a} and ${c}`);
  const col = SORTS[key].col(s);
  const order = dir === 'asc' ? s`${col} asc, id asc` : s`${col} desc, id asc`;
  const rows = await s`select * from tasks where ${where} order by ${order}`;
  // 검색·필터와 무관한 계획 전체 현황(삭제되지 않은 할 일 기준)
  const [summary] = await s`select count(*)::int as total, count(*) filter (where status = 'done')::int as done
                            from tasks where plan_id = ${pid} and deleted_at is null`;
  const dirLabel = SORTS[key].dirLabel?.[dir] ?? (dir === 'asc' ? '오름차순' : '내림차순');
  return {
    sort: { key, dir, label: `${SORTS[key].label} ${dirLabel} → 같으면 ID 오름차순` },
    summary,
    tasks: rows,
  };
}

// ---------- 실행 기록 ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// 시각: 시간대가 없는 'YYYY-MM-DDTHH:mm'(화면의 datetime-local)은 서울 시간으로 해석한다.
function ts(v, name) {
  if (typeof v !== 'string' || !v) throw new HttpError(400, `${name}은(는) 필수입니다`);
  const iso = LOCAL_TS_RE.test(v) ? v + (v.length === 16 ? ':00' : '') + '+09:00' : v;
  const d = new Date(iso);
  if (isNaN(d)) throw new HttpError(400, `${name}의 형식이 올바르지 않습니다`);
  return d;
}
const seoulDayStart = (ymd) => new Date(`${ymd}T00:00:00+09:00`);

function runInput(b, plan) {
  const started = ts(b.started_at, '시작 시각');
  const ended = ts(b.ended_at, '종료 시각');
  if (ended <= started) throw new HttpError(400, '종료 시각은 시작 시각보다 늦어야 합니다');
  if (ended.getTime() > Date.now() + 60_000) throw new HttpError(400, '종료 시각이 지금보다 늦을 수 없습니다');
  const periodStart = seoulDayStart(plan.period_start);
  const periodEnd = new Date(seoulDayStart(plan.period_end).getTime() + 86_400_000); // 종료일 다음 날 0시(서울)
  if (started < periodStart || ended > periodEnd) {
    throw new HttpError(400, `실행 기록은 계획 기간(${plan.period_start} ~ ${plan.period_end}, 서울 시간) 안이어야 합니다`);
  }
  const span = Math.ceil((ended - started) / 60_000); // 종료−시작(분, 올림)
  const raw = b.actual_minutes;
  const actual = raw === undefined || raw === null || raw === '' ? Math.round((ended - started) / 60_000) : minutes(raw, '실제 소요 시간');
  if (actual > span) throw new HttpError(400, `실제 소요 시간은 종료−시작(${span}분)보다 클 수 없습니다`);
  let blocker = null;
  if (b.blocker !== undefined && b.blocker !== null && String(b.blocker).trim() !== '') blocker = text(b.blocker, '막힘 사유', 500);
  return { started_at: started, ended_at: ended, actual_minutes: actual, blocker };
}

async function getTask(s, tid) {
  const [t] = await s`select * from tasks where id = ${tid} and deleted_at is null`;
  if (!t) throw new HttpError(404, '할 일을 찾을 수 없습니다');
  return t;
}

async function getPlan(s, pid) {
  const [p] = await s`select * from plans where id = ${pid}`;
  if (!p) throw new HttpError(404, '계획을 찾을 수 없습니다');
  return p;
}

// ---------- 라우팅 ----------
export async function handle({ method, path, query = {}, body = {} }) {
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

  if (res === 'tasks') {
    if (!rid && M === 'GET') return { status: 200, body: await listTasks(s, query) };
    if (!rid && M === 'POST') {
      const plan = await getPlan(s, id(body.plan_id, 'plan_id'));
      const o = taskInput(body);
      checkDueInPlan(o.due_date, plan);
      const [task] = await s`insert into tasks ${s({ plan_id: plan.id, ...o })} returning *`;
      return { status: 201, body: { task } };
    }

    const tid = id(rid);
    const cur = await getTask(s, tid);
    if (!sub && M === 'GET') return { status: 200, body: { task: cur } };

    if (!sub && M === 'PATCH') {
      const o = taskInput(body, true);
      if (!Object.keys(o).length) return { status: 200, body: { task: cur } };
      if (o.due_date) checkDueInPlan(o.due_date, await getPlan(s, cur.plan_id));
      const [task] = await s`update tasks set ${s({ ...o, updated_at: new Date() })} where id = ${tid} returning *`;
      return { status: 200, body: { task } };
    }
    if (!sub && M === 'DELETE') {
      await s`update tasks set deleted_at = now(), updated_at = now() where id = ${tid}`;
      return { status: 200, body: { deleted: true } };
    }
    // 완료: 화면이 만든 멱등성 키를 받아 DB 함수에서 한 번만 기록한다
    if (sub === 'complete' && M === 'POST') {
      const key = String(body.idempotency_key ?? '');
      if (!UUID_RE.test(key)) throw new HttpError(400, 'idempotency_key(UUID)가 필요합니다');
      let result;
      try {
        [{ complete_task: result }] = await s`select complete_task(${tid}, ${key}::uuid)`;
      } catch (e) {
        // 동시에 들어온 요청이 유니크 제약에 걸린 경우 = 이미 완료됨
        if (e.code !== '23505') throw e;
        result = { created: false, reason: 'already_done' };
      }
      return { status: result.created ? 201 : 200, body: { ...result, task: await getTask(s, tid) } };
    }
    if (sub === 'reopen' && M === 'POST') {
      const [{ uncomplete_task: result }] = await s`select uncomplete_task(${tid})`;
      return { status: 200, body: { ...result, task: await getTask(s, tid) } };
    }
    if (sub === 'completions' && M === 'GET') {
      const completions = await s`select * from task_completions where task_id = ${tid} order by id asc`;
      return { status: 200, body: { completions } };
    }
  }

  if (res === 'runs' && !rid) {
    if (M === 'GET') {
      const pid = id(query.plan_id, 'plan_id');
      const conds = [s`t.plan_id = ${pid}`, s`t.deleted_at is null`];
      if (query.task_id) conds.push(s`r.task_id = ${id(query.task_id, 'task_id')}`);
      const where = conds.reduce((a, c) => s`${a} and ${c}`);
      const runs = await s`
        select r.*, t.title as task_title from runs r join tasks t on t.id = r.task_id
        where ${where} order by r.started_at asc, r.id asc`;
      return { status: 200, body: { runs } };
    }
    if (M === 'POST') {
      const task = await getTask(s, id(body.task_id, 'task_id'));
      const plan = await getPlan(s, task.plan_id);
      const [run] = await s`insert into runs ${s({ task_id: task.id, ...runInput(body, plan) })} returning *`;
      return { status: 201, body: { run } };
    }
  }

  if (res === 'completions' && !rid && M === 'GET') {
    const pid = id(query.plan_id, 'plan_id');
    const completions = await s`
      select c.* from task_completions c join tasks t on t.id = c.task_id
      where t.plan_id = ${pid} and t.deleted_at is null order by c.id asc`;
    return { status: 200, body: { completions } };
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
    const status = e instanceof HttpError ? e.status
      : e.code === 'P0002' ? 404
      : ['22P02', '23514', '22007', '22008', '22023'].includes(e.code) ? 400 : 500;
    // DB 함수가 직접 올린 메시지(P0002·22023)는 사용자에게 보여 줘도 되는 문구다
    const message = e instanceof HttpError || ['P0002', '22023'].includes(e.code) ? e.message
      : status === 400 ? '입력값이 올바르지 않습니다' : '서버 오류가 발생했습니다';
    if (status === 500) console.error(e);
    return { status, headers, body: toJSON({ error: message }) };
  }
}
