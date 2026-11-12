// 화면 코드. 사용자 입력은 모두 textContent(createTextNode)로만 그린다 → HTML로 해석되지 않아 스크립트가 실행되지 않는다.
const app = document.getElementById('app');
const TZ = 'Asia/Seoul';
const PRIO = { high: '높음', medium: '보통', low: '낮음' };
const FIELDS = [
  ['title', '제목'], ['period_start', '시작일'], ['period_end', '종료일'],
  ['priority', '우선순위'], ['success_criteria', '성공 기준'], ['estimated_minutes', '예상 시간'],
];

// ---------- 도우미 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}
async function api(path, opts = {}) {
  const r = await fetch('/api/' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`);
  return data;
}
const fmtTs = (iso) => new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(iso));
const fmtMin = (m) => { m = Number(m) || 0; return m >= 60 ? `${m}분 (${Math.floor(m / 60)}시간 ${m % 60}분)` : `${m}분`; };
const todaySeoul = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
// datetime-local 입력용 서울 현재 시각 'YYYY-MM-DDTHH:mm'
function seoulNowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const show = (k, v) => (k === 'priority' ? PRIO[v] : k === 'estimated_minutes' ? fmtMin(v) : String(v));
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const field = (label, input) => h('label', {}, label, input);
const prioSelect = (val = 'medium') => h('select', { name: 'priority' }, ...Object.entries(PRIO).map(([k, v]) => h('option', { value: k, selected: k === val }, v)));
const guard = (fn) => async (e) => { e?.preventDefault?.(); try { await fn(e); } catch (err) { toast(err.message); } };

// 생성·수정 공용 입력 폼
function planFields(p = {}) {
  return [
    h('div', { class: 'grid' },
      field('제목', h('input', { name: 'title', required: true, maxlength: 200, value: p.title })),
      field('시작일', h('input', { name: 'period_start', type: 'date', required: true, value: p.period_start || todaySeoul() })),
      field('종료일', h('input', { name: 'period_end', type: 'date', required: true, value: p.period_end })),
      field('우선순위', prioSelect(p.priority)),
      field('예상 시간(분)', h('input', { name: 'estimated_minutes', type: 'number', min: 0, step: 1, required: true, value: p.estimated_minutes }))),
    h('label', { class: 'mt' }, '성공 기준', h('textarea', { name: 'success_criteria', required: true, maxlength: 1000 }, p.success_criteria || '')),
  ];
}
const toBody = (d) => ({ ...d, estimated_minutes: Number(d.estimated_minutes) });

// ---------- 라우팅 ----------
window.addEventListener('hashchange', route);
route();
async function route() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  app.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));
  try {
    if (parts[0] === 'plan' && parts[1] && parts[2] === 'review') await reviewPage(parts[1], q);
    else if (parts[0] === 'plan' && parts[1]) await planPage(parts[1], q);
    else await homePage(q);
  } catch (e) {
    app.replaceChildren(h('p', { class: 'err' }, '오류: ' + e.message));
  }
}

// ---------- 계획 목록 + 새 계획 ----------
async function homePage(q = {}) {
  const { plans } = await api('plans');
  // 회고에서 '다음 계획 만들기'로 들어온 경우
  const review = q.from_review ? (await api(`reviews/${encodeURIComponent(q.from_review)}`)).review : null;
  const list = h('section', { class: 'card' },
    h('h2', {}, `계획 ${plans.length}개`),
    plans.length
      ? h('table', {},
          h('thead', {}, h('tr', {}, ...['ID', '제목', '기간', '우선순위', '예상 시간', '버전'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...plans.map((p) => h('tr', {},
            h('td', {}, p.id),
            h('td', {}, h('a', { href: `#/plan/${p.id}` }, p.title),
              p.carried_improvement ? h('div', { class: 'muted' }, `↳ 회고 #${p.from_review_id} 개선점: `, p.carried_improvement) : null),
            h('td', {}, `${p.period_start} ~ ${p.period_end}`),
            h('td', {}, PRIO[p.priority]),
            h('td', {}, fmtMin(p.estimated_minutes)),
            h('td', {}, `v${p.revision}`)))))
      : h('p', { class: 'muted' }, '아직 계획이 없습니다. 지금 실제로 하고 있는 일 하나를 아래에서 등록하세요.'));

  const form = h('form', { id: 'plan-form', class: 'card', onsubmit: guard(async (e) => {
    const { plan } = await api('plans', { method: 'POST', body: { ...toBody(formData(e.target)), from_review_id: review?.id } });
    toast('계획을 저장했습니다');
    location.hash = `#/plan/${plan.id}`;
  }) },
    h('h2', {}, review ? `회고 #${review.id}를 반영한 다음 계획 만들기` : '새 계획 등록'),
    review ? h('div', { class: 'carry' }, '반영할 개선점: ', h('b', {}, review.improvement)) : null,
    ...planFields(),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, '계획 저장')));

  app.replaceChildren(h('h1', {}, '계획'), review ? form : list, review ? list : form);
  if (review) form.querySelector('input[name=title]').focus();
}

// ---------- 계획 상세: 현재 값 · 수정 · 이력 ----------
async function planPage(pid, q = {}) {
  // 화면 상태(검색어·필터·정렬)는 주소(#/plan/1?sort=...)에 둔다 → 새로고침해도 유지
  const tq = { q: q.q || '', status: q.status || '', priority: q.priority || '', sort: q.sort || 'due_date', dir: q.dir || 'asc' };
  const [{ plan: p }, { revisions }, taskRes, { runs }, { completions }] = await Promise.all([
    api(`plans/${pid}`), api(`plans/${pid}/revisions`),
    api(`tasks?${new URLSearchParams({ plan_id: pid, ...tq })}`),
    api(`runs?plan_id=${pid}`), api(`completions?plan_id=${pid}`)]);
  const byTask = (list) => list.reduce((m, x) => ((m[x.task_id] ||= []).push(x), m), {});
  const ctx = { runsByTask: byTask(runs), completionsByTask: byTask(completions) };

  const current = h('section', { class: 'card' },
    h('h2', {}, '현재 계획'),
    h('table', {}, h('tbody', {},
      h('tr', {}, h('th', {}, 'ID'), h('td', {}, p.id)),
      h('tr', {}, h('th', {}, '기간'), h('td', {}, `${p.period_start} ~ ${p.period_end}`)),
      h('tr', {}, h('th', {}, '우선순위'), h('td', {}, PRIO[p.priority])),
      h('tr', {}, h('th', {}, '성공 기준'), h('td', {}, h('div', { class: 'pre' }, p.success_criteria))),
      h('tr', {}, h('th', {}, '예상 시간'), h('td', {}, fmtMin(p.estimated_minutes))),
      h('tr', {}, h('th', {}, '버전'), h('td', {}, `v${p.revision} · 최종 수정 ${fmtTs(p.updated_at)}`)))));

  const edit = h('section', { class: 'card' },
    h('details', {},
      h('summary', {}, '계획 수정하기'),
      h('form', { id: 'plan-edit', onsubmit: guard(async (e) => {
        const r = await api(`plans/${p.id}`, { method: 'PATCH', body: toBody(formData(e.target)) });
        toast(r.changed ? '수정했습니다. 이전 버전은 이력에 남아 있습니다' : '바뀐 내용이 없어 새 버전을 만들지 않았습니다');
        route();
      }) },
        ...planFields(p),
        h('div', { class: 'row' }, h('button', { type: 'submit' }, '수정 저장')))));

  // 버전마다 바로 앞 버전과 달라진 항목만 보여 준다(v1은 전체)
  const history = h('section', { class: 'card', id: 'revisions' },
    h('h2', {}, `수정 이력 · ${revisions.length}개 버전`),
    h('p', { class: 'muted' }, 'v1이 최초 계획입니다. 이력은 수정하거나 지울 수 없습니다.'),
    ...revisions.map((r, i) => {
      const prev = revisions[i - 1]?.snapshot;
      const keys = prev ? FIELDS.filter(([k]) => String(prev[k]) !== String(r.snapshot[k])) : FIELDS;
      return h('div', { class: 'rev' + (i === 0 ? ' first' : ''), 'data-revision': r.revision },
        h('div', {}, h('b', {}, `v${r.revision}`), i === 0 ? ' (최초 계획)' : '', ' ', h('span', { class: 'muted' }, fmtTs(r.saved_at))),
        h('ul', {}, ...keys.map(([k, label]) => h('li', {},
          `${label}: `,
          prev ? h('span', { class: 'old' }, show(k, prev[k])) : null,
          prev ? ' → ' : null,
          show(k, r.snapshot[k])))));
    }));

  app.replaceChildren(
    h('p', { class: 'row nav' }, h('a', { href: '#/' }, '← 계획 목록'), h('a', { class: 'btn', href: `#/plan/${p.id}/review` }, '회고 보기 →')),
    h('h1', {}, `계획 #${p.id} · `, p.title),
    p.carried_improvement ? h('div', { class: 'carry' }, `회고 #${p.from_review_id}에서 반영한 개선점: `, h('b', {}, p.carried_improvement)) : null,
    current, tasksCard(p, taskRes, tq, ctx), runsCard(runs), edit, history);
}

// ---------- 회고 ----------
const METRICS = [
  ['planned', '계획 수', (s) => `${s.planned}건`],
  ['done', '완료 수', (s) => `${s.done}건`],
  ['delayed', '지연 수', (s) => `${s.delayed}건`],
  ['blocked', '막힘 수', (s) => `${s.blocked}건`],
  ['estimated', '예상 시간', (s) => fmtMin(s.estimated_minutes)],
  ['actual', '실제 시간', (s) => fmtMin(s.actual_minutes)],
  ['diff', '차이(실제−예상)', (s) => fmtSigned(s.diff_minutes)],
];
const fmtSigned = (m) => (m > 0 ? '+' : '') + fmtMin(m);

async function reviewPage(pid, q) {
  const week = q.week || '';
  const show = q.show || '';
  const wq = week ? `?week=${encodeURIComponent(week)}` : '';
  const [{ plan: p }, { stats, weeks }, { reviews, next_plans }, ev] = await Promise.all([
    api(`plans/${pid}`), api(`plans/${pid}/stats${wq}`), api(`plans/${pid}/reviews`),
    show ? api(`plans/${pid}/evidence?${new URLSearchParams({ metric: show, ...(week ? { week } : {}) })}`) : null]);
  const link = (next) => {
    const params = Object.fromEntries(Object.entries({ week, show, ...next }).filter(([, v]) => v));
    const qs = new URLSearchParams(params).toString();
    return `#/plan/${p.id}/review${qs ? '?' + qs : ''}`;
  };
  const scopeLabel = stats.scope ? weeks.find((w) => w.n === stats.scope.week).label : `계획 전체 (${p.period_start} ~ ${p.period_end})`;

  const scopeNav = h('p', { class: 'row', id: 'scope' }, '범위: ',
    h('a', { class: 'chip' + (week ? '' : ' on'), href: link({ week: '', show }) }, '계획 전체'),
    ...weeks.map((w) => h('a', { class: 'chip' + (String(w.n) === week ? ' on' : ''), href: link({ week: String(w.n), show }) }, w.label)));

  const tiles = h('section', { class: 'card', id: 'stats' },
    h('h2', {}, '회고 집계'),
    h('p', { class: 'muted' }, `${scopeLabel} · 서울 기준 오늘 ${stats.today_seoul} · 시간 단위: 분 · 숫자를 누르면 근거 기록이 아래에 열립니다`),
    h('div', { class: 'stats' }, ...METRICS.map(([k, label, fmt]) =>
      h('a', { class: 'stat' + (show === k ? ' on' : ''), href: link({ show: k }), 'data-metric': k }, h('b', {}, fmt(stats)), h('span', {}, label)))));

  const evidence = ev ? evidenceCard(ev, stats, link) : null;

  const form = h('form', { id: 'review-form', class: 'row', onsubmit: guard(async (e) => {
    const d = formData(e.target);
    const msg = `회고를 저장할까요?\n범위: ${scopeLabel}\n개선점: ${d.improvement}\n\n지금의 집계 값이 함께 저장되며, 회고는 고치거나 지울 수 없습니다.`;
    if (!confirm(msg)) return;
    await api('reviews', { method: 'POST', body: { plan_id: p.id, week: week || undefined, improvement: d.improvement } });
    toast('회고를 저장했습니다'); route();
  }) },
    h('label', { class: 'grow' }, `다음 계획에 반영할 개선점 한 줄 (범위: ${scopeLabel})`, h('input', { name: 'improvement', required: true, maxlength: 300 })),
    h('button', { type: 'submit' }, '회고 저장'));

  const nextOf = (rid) => next_plans.filter((x) => x.from_review_id === rid);
  const list = reviews.length
    ? h('div', { class: 'scroll' }, h('table', { id: 'review-list' },
        h('thead', {}, h('tr', {}, ...['회고', '저장 시각', '범위', '개선점', '저장 시점 집계', '다음 계획'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...reviews.map((r) => {
          const sn = r.snapshot;
          return h('tr', { 'data-review': r.id },
            h('td', {}, `#${r.id}`), h('td', { class: 'nowrap' }, fmtTs(r.created_at)),
            h('td', { class: 'nowrap' }, r.scope_from ? `${r.scope_from} ~ ${r.scope_to}` : '계획 전체'),
            h('td', {}, r.improvement),
            h('td', { class: 'muted' }, `계획 ${sn.planned} · 완료 ${sn.done} · 지연 ${sn.delayed} · 막힘 ${sn.blocked} · 예상 ${sn.estimated_minutes} · 실제 ${sn.actual_minutes} · 차이 ${sn.diff_minutes}분 (오늘 ${sn.today_seoul})`),
            h('td', {}, ...nextOf(r.id).map((n) => h('div', {}, h('a', { href: `#/plan/${n.id}` }, `계획 #${n.id} `, n.title))),
              h('a', { href: `#/?from_review=${r.id}` }, '이 개선점으로 다음 계획 만들기')));
        }))))
    : h('p', { class: 'muted' }, '아직 저장한 회고가 없습니다.');

  app.replaceChildren(
    h('p', { class: 'row nav' }, h('a', { href: `#/plan/${p.id}` }, `← 계획 #${p.id}`)),
    h('h1', {}, `회고 · 계획 #${p.id} `, p.title),
    scopeNav, tiles, evidence,
    h('section', { class: 'card', id: 'reviews' }, h('h2', {}, '회고 → 다음 계획'), form, h('h3', {}, '저장한 회고'), list));
  if (show) document.getElementById('evidence')?.scrollIntoView({ block: 'start' });
}

function evidenceCard(ev, stats, link) {
  const shown = { planned: stats.planned, done: stats.done, delayed: stats.delayed, blocked: stats.blocked, estimated: stats.estimated_minutes, actual: stats.actual_minutes, diff: stats.diff_minutes }[ev.metric];
  const fromRows = { planned: ev.totals.count, done: ev.totals.count, delayed: ev.totals.count, blocked: ev.totals.count,
    estimated: ev.totals.estimated_minutes, actual: ev.totals.actual_minutes, diff: ev.totals.actual_minutes - ev.totals.estimated_minutes }[ev.metric];
  const unit = ['planned', 'done', 'delayed', 'blocked'].includes(ev.metric) ? '건' : '분';
  const check = h('p', { class: 'check ' + (shown === fromRows ? 'ok' : 'bad'), id: 'evidence-check' },
    `집계 값 ${shown}${unit} = 아래 근거 기록에서 계산한 값 ${fromRows}${unit} ${shown === fromRows ? '✓ 일치' : '✗ 불일치'}`);

  const taskTable = ev.tasks ? (ev.tasks.length
    ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['ID', '할 일', '상태', '마감일', '예상', '실제(기록 수)', '차이'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...ev.tasks.map((t) => h('tr', { 'data-task': t.id },
          h('td', {}, t.id), h('td', {}, h('a', { href: `#/plan/${t.plan_id}` }, t.title)),
          h('td', {}, t.status === 'done' ? '완료' : '진행 중'), h('td', { class: 'nowrap' }, t.due_date),
          h('td', { class: 'nowrap' }, `${t.estimated_minutes}분`), h('td', { class: 'nowrap' }, `${t.actual_minutes}분 (${t.run_count}건)`),
          h('td', { class: 'nowrap' }, `${t.actual_minutes - t.estimated_minutes > 0 ? '+' : ''}${t.actual_minutes - t.estimated_minutes}분`)))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, `합계 ${ev.totals.count}건`),
          h('td', {}, `${ev.totals.estimated_minutes}분`), h('td', {}, `${ev.totals.actual_minutes}분`),
          h('td', {}, `${ev.totals.actual_minutes - ev.totals.estimated_minutes}분`)))))
    : h('p', { class: 'muted' }, '해당하는 할 일이 없습니다(0건).')) : null;

  const runTable = ev.runs ? (ev.runs.length
    ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['기록', '할 일', '시작 ~ 종료', '실제', '막힘 사유'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...ev.runs.map((r) => h('tr', { 'data-run': r.id },
          h('td', {}, `#${r.id}`), h('td', {}, `#${r.task_id} `, r.task_title), h('td', { class: 'nowrap' }, fmtRange(r)),
          h('td', { class: 'nowrap' }, `${r.actual_minutes}분`), h('td', {}, r.blocker || '-'))))))
    : h('p', { class: 'muted' }, '해당하는 실행 기록이 없습니다(0건).')) : null;

  return h('section', { class: 'card', id: 'evidence', 'data-metric': ev.metric },
    h('h2', {}, `근거: ${ev.label}`),
    h('p', { class: 'muted' }, '규칙: ', ev.rule),
    check,
    ev.metric === 'blocked' ? h('h3', {}, '막힌 할 일') : null, taskTable,
    ev.metric === 'blocked' ? h('h3', {}, '막힘 사유가 적힌 실행 기록') : null, runTable,
    h('p', {}, h('a', { href: link({ show: '' }) }, '근거 닫기')));
}

// ---------- 실행 기록 ----------
const fmtRange = (r) => `${fmtTs(r.started_at)} ~ ${fmtTs(r.ended_at)}`;

function runsCard(runs) {
  const total = runs.reduce((a, r) => a + r.actual_minutes, 0);
  return h('section', { class: 'card', id: 'runs' },
    h('h2', {}, `실행 기록 · ${runs.length}건`),
    h('p', { class: 'muted' }, `시각은 서울 시간 · 실제 시간 합계 ${fmtMin(total)} · 기록은 추가만 할 수 있습니다(계획·할 일 값은 바뀌지 않음)`),
    runs.length
      ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['기록', '할 일', '시작 ~ 종료', '실제', '막힘 사유'].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...runs.map((r) => h('tr', { 'data-run': r.id },
            h('td', {}, `#${r.id}`),
            h('td', {}, h('a', { href: `#task-${r.task_id}`, onclick: (e) => { e.preventDefault(); document.querySelector(`tr[data-task="${r.task_id}"]`)?.scrollIntoView({ block: 'center' }); } }, `#${r.task_id} `, r.task_title)),
            h('td', { class: 'nowrap' }, fmtRange(r)),
            h('td', { class: 'nowrap' }, fmtMin(r.actual_minutes)),
            h('td', {}, r.blocker || '-'))))))
      : h('p', { class: 'muted' }, '아직 실행 기록이 없습니다. 할 일의 "실행 기록"에서 추가하세요.'));
}

// 할 일 한 줄 안의 실행 기록·완료 기록 영역
function taskLog(t, p, runs = [], completions = []) {
  const now = seoulNowLocal();
  const min = `${p.period_start}T00:00`;
  const max = now < `${p.period_end}T23:59` ? now : `${p.period_end}T23:59`;
  const preview = h('span', { class: 'muted' });
  const form = h('form', { class: 'row', onsubmit: guard(async (e) => {
    const d = formData(e.target);
    const msg = `할 일 #${t.id}에 실행 기록을 추가할까요?\n${d.started_at.replace('T', ' ')} ~ ${d.ended_at.replace('T', ' ')}\n실제 ${d.actual_minutes || '(자동)'}분 · 막힘 ${d.blocker || '없음'}\n\n저장한 기록은 고치거나 지울 수 없습니다.`;
    if (!confirm(msg)) return;
    await api('runs', { method: 'POST', body: { task_id: t.id, ...d } });
    toast('실행 기록을 저장했습니다'); route();
  }), oninput: (e) => {
    const f = e.currentTarget;
    const a = Date.parse(f.started_at.value), b = Date.parse(f.ended_at.value);
    preview.textContent = a && b && b > a ? `종료−시작 ${Math.round((b - a) / 60000)}분` : '';
  } },
    field('시작(서울)', h('input', { name: 'started_at', type: 'datetime-local', required: true, min, max })),
    field('종료(서울)', h('input', { name: 'ended_at', type: 'datetime-local', required: true, min, max, value: max })),
    field('실제(분, 비우면 자동)', h('input', { name: 'actual_minutes', type: 'number', min: 0, step: 1, class: 'narrow' })),
    field('막힘 사유(선택)', h('input', { name: 'blocker', maxlength: 500 })),
    h('button', { type: 'submit' }, '기록 추가'), preview);

  return h('details', { class: 'log' },
    h('summary', {}, `실행 기록 ${runs.length}건 · 완료 기록 ${completions.length}건`),
    runs.length
      ? h('ul', { class: 'runs' }, ...runs.map((r) => h('li', {}, `#${r.id} ${fmtRange(r)} · ${fmtMin(r.actual_minutes)}`, r.blocker ? h('span', { class: 'blocker' }, ' · 막힘: ', r.blocker) : null)))
      : h('p', { class: 'muted' }, '실행 기록 없음'),
    completions.length
      ? h('ul', { class: 'completions' }, ...completions.map((c) => h('li', { class: c.undone_at ? 'undone' : '' },
          `완료 #${c.id} ${fmtTs(c.completed_at)}`, c.undone_at ? ` → 취소 ${fmtTs(c.undone_at)}` : ' (유효)')))
      : null,
    form);
}

// ---------- 할 일 ----------
const SORT_OPTIONS = [['due_date', '마감일'], ['priority', '우선순위'], ['estimated_minutes', '예상 시간'], ['created_at', '등록 시각'], ['title', '제목']];
const opt = (value, label, cur) => h('option', { value, selected: value === cur }, label);

function tasksCard(p, { tasks, sort, summary }, tq, ctx) {
  const go = (next) => {
    const params = Object.fromEntries(Object.entries({ ...tq, ...next }).filter(([, v]) => v));
    location.hash = `#/plan/${p.id}?${new URLSearchParams(params)}`;
  };
  const dateRange = { min: p.period_start, max: p.period_end };

  const filters = h('form', { id: 'task-filter', class: 'row', onsubmit: (e) => { e.preventDefault(); go(formData(e.target)); } },
    field('검색(제목·태그)', h('input', { name: 'q', value: tq.q, maxlength: 100 })),
    field('상태', h('select', { name: 'status' }, opt('', '전체', tq.status), opt('open', '진행 중', tq.status), opt('done', '완료', tq.status))),
    field('우선순위', h('select', { name: 'priority' }, opt('', '전체', tq.priority), ...Object.entries(PRIO).map(([k, v]) => opt(k, v, tq.priority)))),
    field('정렬 기준', h('select', { name: 'sort' }, ...SORT_OPTIONS.map(([k, v]) => opt(k, v, tq.sort)))),
    field('방향', h('select', { name: 'dir' }, opt('asc', '오름차순', tq.dir), opt('desc', '내림차순', tq.dir))),
    h('button', { type: 'submit' }, '적용'),
    h('button', { type: 'button', class: 'ghost', onclick: () => { location.hash = `#/plan/${p.id}`; } }, '초기화'));

  const today = todaySeoul();
  const rows = tasks.map((t) => {
    const late = t.status === 'open' && t.due_date < today;
    // 이 화면에서 이 할 일을 '완료'하려는 한 번의 의도 = 멱등성 키 하나. 두 번 눌러도 같은 키가 간다.
    const completeKey = crypto.randomUUID();
    const state = t.status === 'done' ? ['완료', 'done'] : late ? ['지연', 'late'] : ['진행 중', ''];
    return h('tr', { class: t.status === 'done' ? 'is-done' : '', 'data-task': t.id },
      h('td', {}, t.id),
      h('td', { class: 't-title' }, t.title, h('div', {}, ...t.tags.map((g) => h('span', { class: 'tag' }, g)))),
      h('td', {}, h('span', { class: `badge ${state[1]}` }, state[0])),
      h('td', {}, t.due_date),
      h('td', {}, PRIO[t.priority]),
      h('td', {}, fmtMin(t.estimated_minutes)),
      h('td', { class: 'actions' },
        t.status === 'done'
          ? h('button', { class: 'ghost', onclick: guard(async () => { await api(`tasks/${t.id}/reopen`, { method: 'POST' }); toast('진행 중으로 되돌렸습니다'); route(); }) }, '완료 취소')
          // 버튼을 막지 않는다: 두 번 눌러 요청이 두 번 가도 서버(키 + 유니크 제약)가 한 번만 기록한다
          : h('button', { 'data-complete': t.id, onclick: guard(async () => {
              const r = await api(`tasks/${t.id}/complete`, { method: 'POST', body: { idempotency_key: completeKey } });
              toast(r.created ? '완료했습니다' : '이미 완료된 요청입니다(기록은 1건)');
              if (r.created) route();
            }) }, '완료'),
        h('button', { class: 'danger', onclick: guard(async () => {
          if (!confirm(`할 일 #${t.id} "${t.title}"을(를) 삭제할까요?`)) return;
          await api(`tasks/${t.id}`, { method: 'DELETE' }); toast('삭제했습니다'); route();
        }) }, '삭제'),
        taskEdit(t, dateRange),
        taskLog(t, p, ctx.runsByTask[t.id], ctx.completionsByTask[t.id])));
  });

  const addForm = h('form', { id: 'task-form', class: 'row', onsubmit: guard(async (e) => {
    await api('tasks', { method: 'POST', body: { ...toTaskBody(formData(e.target)), plan_id: p.id } });
    toast('할 일을 추가했습니다'); route();
  }) }, ...taskFields({}, dateRange), h('button', { type: 'submit' }, '할 일 추가'));

  return h('section', { class: 'card', id: 'tasks' },
    h('h2', {}, '할 일'),
    h('p', { class: 'muted', id: 'task-summary' }, `전체 ${summary.total}건 · 완료 ${summary.done}건 (검색·필터와 무관한 계획 전체 기준)`),
    filters,
    h('p', { class: 'sortline' }, '정렬 기준: ', h('b', { id: 'sort-label' }, sort.label), h('span', { class: 'muted' }, ` · ${tasks.length}건`)),
    tasks.length
      ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['ID', '할 일', '상태', '마감일', '우선순위', '예상', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...rows)))
      : h('p', { class: 'muted' }, '조건에 맞는 할 일이 없습니다.'),
    h('h3', {}, '할 일 추가'), addForm);
}

function taskFields(t, range) {
  return [
    field('할 일', h('input', { name: 'title', required: true, maxlength: 200, value: t.title })),
    field('마감일', h('input', { name: 'due_date', type: 'date', required: true, ...range, value: t.due_date })),
    field('우선순위', prioSelect(t.priority)),
    field('태그(쉼표로 구분)', h('input', { name: 'tags', maxlength: 200, value: (t.tags || []).join(', ') })),
    field('예상 시간(분)', h('input', { name: 'estimated_minutes', type: 'number', min: 0, step: 1, required: true, class: 'narrow', value: t.estimated_minutes })),
  ];
}
const toTaskBody = (d) => ({ ...d, estimated_minutes: Number(d.estimated_minutes) });

function taskEdit(t, range) {
  return h('details', { class: 'edit' },
    h('summary', {}, '수정'),
    h('form', { class: 'row', onsubmit: guard(async (e) => {
      await api(`tasks/${t.id}`, { method: 'PATCH', body: toTaskBody(formData(e.target)) });
      toast('할 일을 수정했습니다'); route();
    }) }, ...taskFields(t, range), h('button', { type: 'submit' }, '수정 저장')));
}
