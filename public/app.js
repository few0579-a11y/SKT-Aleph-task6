// 화면 코드. 사용자 입력은 모두 textContent(createTextNode)로만 그린다 → HTML로 해석되지 않아 스크립트가 실행되지 않는다.
// 색·위치처럼 계산한 스타일은 el.style로만 넣는다(CSP가 인라인 style 속성을 막아도 동작).
const app = document.getElementById('app');
const TZ = 'Asia/Seoul';
const PRIO = { high: '높음', medium: '보통', low: '낮음' };
const FIELDS = [
  ['title', '제목'], ['period_start', '시작일'], ['period_end', '종료일'],
  ['priority', '우선순위'], ['success_criteria', '성공 기준'], ['estimated_minutes', '예상 시간'],
];
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// ---------- 도우미 ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'css') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
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
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
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
const fmtMin = (m) => { m = Number(m) || 0; const a = Math.abs(m); return a >= 60 ? `${m}분 (${m < 0 ? '-' : ''}${Math.floor(a / 60)}시간 ${a % 60}분)` : `${m}분`; };
const fmtHm = (m) => { const a = Math.abs(m); return `${m < 0 ? '-' : ''}${Math.floor(a / 60)}시간 ${a % 60}분`; };
const todaySeoul = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function seoulNowLocal() { // datetime-local 입력용 서울 현재 시각 'YYYY-MM-DDTHH:mm'
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// ISO 시각 → 서울 기준 { date: 'YYYY-MM-DD', min: 자정부터 분 }
function seoulParts(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const show = (k, v) => (k === 'priority' ? PRIO[v] : k === 'estimated_minutes' ? fmtMin(v) : String(v));
const formData = (form) => Object.fromEntries(new FormData(form).entries());
const field = (label, input, cls) => h('label', { class: cls }, h('span', { class: 'lbl' }, label), input);
const prioSelect = (val = 'medium') => h('select', { name: 'priority' }, ...Object.entries(PRIO).map(([k, v]) => h('option', { value: k, selected: k === val }, v)));
// 화면 전체 교체. null(조건부로 빠지는 영역)은 건너뛴다 — replaceChildren은 null을 "null" 글자로 넣기 때문
const render = (...nodes) => app.replaceChildren(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
const guard = (fn) => async (e) => { e?.preventDefault?.(); try { await fn(e); } catch (err) { toast(err.message); } };
const card = (attrs, title, ...kids) => h('section', { class: 'card', ...attrs }, title ? h('h2', {}, title) : null, ...kids);

// ---------- 태그 색 ----------
const PALETTE = ['#2f7d68', '#3b6fb6', '#c06a1d', '#8a55b0', '#c03d55', '#24879a', '#6f8a1f', '#8a6a45'];
let tagColors = {}, defaultColors = {};
async function loadTagColors() {
  defaultColors = {};
  try { tagColors = (await api('tag-colors')).colors; } catch { tagColors = {}; } // 색을 못 불러와도 기본 색으로 화면은 연다
}
// 색을 정하지 않은 태그에 기본 색을 나눠 준다: 태그 이름순으로, 이미 쓰인 색은 건너뛰어 서로 겹치지 않게
function assignDefaults(allTags) {
  const used = new Set(Object.values(tagColors));
  defaultColors = {};
  let i = 0;
  for (const g of [...new Set(allTags)].sort()) {
    if (tagColors[g]) continue;
    while (i < PALETTE.length && used.has(PALETTE[i])) i++;
    if (i < PALETTE.length) { defaultColors[g] = PALETTE[i]; used.add(PALETTE[i]); i++; }
  }
}
function colorOf(tag) {
  if (!tag) return '#8a8f98';
  if (tagColors[tag]) return tagColors[tag];
  if (defaultColors[tag]) return defaultColors[tag];
  let x = 0; for (const c of tag) x = (x * 31 + c.codePointAt(0)) >>> 0; // 팔레트가 모자랄 때만
  return PALETTE[x % PALETTE.length];
}
const tagChip = (g) => h('span', { class: 'tag', css: { '--c': colorOf(g) } }, g);

// 생성·수정 공용 입력 폼
function planFields(p = {}) {
  return [
    h('div', { class: 'grid' },
      field('제목', h('input', { name: 'title', required: true, maxlength: 200, value: p.title }), 'span2'),
      field('시작일', h('input', { name: 'period_start', type: 'date', required: true, value: p.period_start || todaySeoul() })),
      field('종료일', h('input', { name: 'period_end', type: 'date', required: true, value: p.period_end })),
      field('우선순위', prioSelect(p.priority)),
      field('예상 시간(분)', h('input', { name: 'estimated_minutes', type: 'number', min: 0, step: 1, required: true, value: p.estimated_minutes })),
      field('성공 기준', h('textarea', { name: 'success_criteria', required: true, maxlength: 1000 }, p.success_criteria || ''), 'full')),
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
  app.replaceChildren(h('p', { class: 'muted loading' }, '불러오는 중…'));
  try {
    if (parts[0] === 'plan' && parts[1]) {
      await loadTagColors();
      const view = parts[2] || '';
      if (view === 'review') await reviewPage(parts[1], q);
      else if (view === 'week') await weekPage(parts[1], q);
      else if (view === 'calendar') await calendarPage(parts[1], q);
      else await planPage(parts[1], q);
    } else await homePage(q);
  } catch (e) {
    app.replaceChildren(h('p', { class: 'err' }, '오류: ' + e.message));
  }
}

// 계획 화면들 위에 공통으로 붙는 제목·탭
function planHeader(p, active) {
  const tabs = [['', '개요·할 일'], ['week', '타임테이블'], ['calendar', '캘린더'], ['review', '회고']];
  return h('div', { class: 'plan-head' },
    h('p', { class: 'crumb' }, h('a', { href: '#/' }, '계획 목록'), ' / ', `계획 #${p.id}`),
    h('h1', {}, p.title),
    h('p', { class: 'meta' },
      h('span', { class: 'pill' }, `${p.period_start} ~ ${p.period_end}`),
      h('span', { class: `pill prio-${p.priority}` }, `우선순위 ${PRIO[p.priority]}`),
      h('span', { class: 'pill' }, `예상 ${fmtHm(p.estimated_minutes)}`),
      h('span', { class: 'pill' }, `v${p.revision}`)),
    p.carried_improvement ? h('div', { class: 'carry' }, `회고 #${p.from_review_id}에서 반영한 개선점: `, h('b', {}, p.carried_improvement)) : null,
    h('nav', { class: 'tabs', 'aria-label': '계획 화면' },
      ...tabs.map(([v, label]) => h('a', { href: `#/plan/${p.id}${v ? '/' + v : ''}`, class: v === active ? 'on' : '', 'aria-current': v === active ? 'page' : null }, label))));
}

// ---------- 계획 목록 + 새 계획 ----------
async function homePage(q = {}) {
  const { plans } = await api('plans');
  // 회고에서 '다음 계획 만들기'로 들어온 경우
  const review = q.from_review ? (await api(`reviews/${encodeURIComponent(q.from_review)}`)).review : null;
  const list = card({ id: 'plan-list' }, `계획 ${plans.length}개`,
    plans.length
      ? h('div', { class: 'plan-cards' }, ...plans.map((p) => h('a', { class: 'plan-card', href: `#/plan/${p.id}`, 'data-plan': p.id },
          h('div', { class: 'pc-top' }, h('span', { class: 'muted' }, `#${p.id} · v${p.revision}`), h('span', { class: `pill prio-${p.priority}` }, PRIO[p.priority])),
          h('b', { class: 'pc-title' }, p.title),
          h('span', { class: 'muted' }, `${p.period_start} ~ ${p.period_end} · 예상 ${fmtHm(p.estimated_minutes)}`),
          p.carried_improvement ? h('span', { class: 'pc-carry' }, `↳ 회고 #${p.from_review_id} 개선점: `, p.carried_improvement) : null)))
      : h('p', { class: 'muted' }, '아직 계획이 없습니다. 지금 실제로 하고 있는 일 하나를 아래에서 등록하세요.'));

  const form = h('form', { id: 'plan-form', class: 'card', onsubmit: guard(async (e) => {
    const { plan } = await api('plans', { method: 'POST', body: { ...toBody(formData(e.target)), from_review_id: review?.id } });
    toast('계획을 저장했습니다');
    location.hash = `#/plan/${plan.id}`;
  }) },
    h('h2', {}, review ? `회고 #${review.id}를 반영한 다음 계획 만들기` : '새 계획 등록'),
    review ? h('div', { class: 'carry' }, '반영할 개선점: ', h('b', {}, review.improvement)) : null,
    ...planFields(),
    h('div', { class: 'row end' }, h('button', { type: 'submit' }, '계획 저장')));

  render(h('h1', { class: 'page-title' }, '계획'), review ? form : list, review ? list : form);
  if (review) form.querySelector('input[name=title]').focus();
}

// ---------- 계획 개요·할 일: 현재 값 · 할 일 · 실행 기록 · 수정 · 이력 ----------
async function planPage(pid, q = {}) {
  // 화면 상태(검색어·필터·정렬)는 주소(#/plan/1?sort=...)에 둔다 → 새로고침해도 유지
  const tq = { q: q.q || '', status: q.status || '', priority: q.priority || '', sort: q.sort || 'due_date', dir: q.dir || 'asc' };
  const [{ plan: p }, { revisions }, taskRes, { runs }, { completions }, { tasks: allTasks }] = await Promise.all([
    api(`plans/${pid}`), api(`plans/${pid}/revisions`),
    api(`tasks?${new URLSearchParams({ plan_id: pid, ...tq })}`),
    api(`runs?plan_id=${pid}`), api(`completions?plan_id=${pid}`), api(`tasks?plan_id=${pid}`)]);
  assignDefaults(allTasks.flatMap((t) => t.tags)); // 검색·필터와 상관없이 태그 색이 같게
  const byTask = (list) => list.reduce((m, x) => ((m[x.task_id] ||= []).push(x), m), {});
  const ctx = { runsByTask: byTask(runs), completionsByTask: byTask(completions) };
  const actual = runs.reduce((a, r) => a + r.actual_minutes, 0);
  const { total, done } = taskRes.summary;

  const overview = card({ class: 'card overview' }, '현재 계획',
    h('div', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('span', {}, '할 일 완료'), h('b', {}, `${done} / ${total}`), bar(total ? done / total : 0)),
      h('div', { class: 'kpi' }, h('span', {}, '실제 / 예상'), h('b', {}, `${fmtHm(actual)} / ${fmtHm(p.estimated_minutes)}`), bar(p.estimated_minutes ? actual / p.estimated_minutes : 0)),
      h('div', { class: 'kpi' }, h('span', {}, '실행 기록'), h('b', {}, `${runs.length}건`), h('small', { class: 'muted' }, '타임테이블에서 시간대별로 보기'))),
    h('dl', { class: 'facts' },
      h('dt', {}, 'ID'), h('dd', {}, p.id),
      h('dt', {}, '기간'), h('dd', {}, `${p.period_start} ~ ${p.period_end}`),
      h('dt', {}, '우선순위'), h('dd', {}, PRIO[p.priority]),
      h('dt', {}, '성공 기준'), h('dd', {}, h('div', { class: 'pre' }, p.success_criteria)),
      h('dt', {}, '예상 시간'), h('dd', {}, fmtMin(p.estimated_minutes)),
      h('dt', {}, '버전'), h('dd', {}, `v${p.revision} · 최종 수정 ${fmtTs(p.updated_at)}`)));

  const edit = h('section', { class: 'card' },
    h('details', {},
      h('summary', {}, '계획 수정하기'),
      h('form', { id: 'plan-edit', onsubmit: guard(async (e) => {
        const r = await api(`plans/${p.id}`, { method: 'PATCH', body: toBody(formData(e.target)) });
        toast(r.changed ? '수정했습니다. 이전 버전은 이력에 남아 있습니다' : '바뀐 내용이 없어 새 버전을 만들지 않았습니다');
        route();
      }) },
        ...planFields(p),
        h('div', { class: 'row end' }, h('button', { type: 'submit' }, '수정 저장')))));

  // 버전마다 바로 앞 버전과 달라진 항목만 보여 준다(v1은 전체)
  const history = card({ id: 'revisions' }, `수정 이력 · ${revisions.length}개 버전`,
    h('p', { class: 'muted' }, 'v1이 최초 계획입니다. 이력은 수정하거나 지울 수 없습니다.'),
    h('ol', { class: 'timeline' }, ...revisions.map((r, i) => {
      const prev = revisions[i - 1]?.snapshot;
      const keys = prev ? FIELDS.filter(([k]) => String(prev[k]) !== String(r.snapshot[k])) : FIELDS;
      return h('li', { class: 'rev' + (i === 0 ? ' first' : ''), 'data-revision': r.revision },
        h('div', { class: 'rev-head' }, h('b', {}, `v${r.revision}`), i === 0 ? h('span', { class: 'pill' }, '최초 계획') : null, h('span', { class: 'muted' }, fmtTs(r.saved_at))),
        h('ul', {}, ...keys.map(([k, label]) => h('li', {},
          h('span', { class: 'muted' }, `${label}: `),
          prev ? h('span', { class: 'old' }, show(k, prev[k])) : null,
          prev ? ' → ' : null,
          show(k, r.snapshot[k])))));
    })));

  render(planHeader(p, ''), overview, tasksCard(p, taskRes, tq, ctx), runsCard(runs), edit, history);
}
const bar = (ratio) => h('div', { class: 'bar' }, h('i', { css: { width: `${Math.min(100, Math.round(ratio * 100))}%` } }));

// ---------- 주간 타임테이블 ----------
const HOUR_PX = 56;
function planWeeks(p) {
  const weeks = [];
  for (let n = 1, from = p.period_start; from <= p.period_end; n++, from = addDays(from, 7)) {
    const to = addDays(from, 6) < p.period_end ? addDays(from, 6) : p.period_end;
    weeks.push({ n, from, to });
  }
  return weeks;
}
// 실행 기록을 서울 날짜별 조각으로 나눈다(자정을 넘기면 두 조각)
function runSegments(runs, tasksById) {
  const segs = [];
  for (const r of runs) {
    const s = seoulParts(r.started_at), e = seoulParts(r.ended_at);
    const task = tasksById[r.task_id];
    const tag = task?.tags?.[0] || '';
    for (let d = s.date; d <= e.date; d = addDays(d, 1)) {
      const from = d === s.date ? s.min : 0, to = d === e.date ? e.min : 1440;
      if (to > from) segs.push({ run: r, task, tag, date: d, from, to });
    }
  }
  return segs;
}

async function weekPage(pid, q) {
  const [{ plan: p }, { runs }, { tasks }] = await Promise.all([api(`plans/${pid}`), api(`runs?plan_id=${pid}`), api(`tasks?plan_id=${pid}`)]);
  assignDefaults(tasks.flatMap((t) => t.tags));
  const weeks = planWeeks(p);
  const today = todaySeoul();
  const cur =weeks.find((w) => String(w.n) === q.week) || weeks.find((w) => w.from <= today && today <= w.to) || weeks[0];
  const tasksById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(cur.from, i));
  const segs = runSegments(runs, tasksById).filter((s) => days.includes(s.date));
  const runsInWeek = [...new Set(segs.map((s) => s.run))];

  // 기본 08~23시, 기록이 그 밖에 있으면 넓힌다
  let startH = 8, endH = 23;
  for (const s of segs) { startH = Math.min(startH, Math.floor(s.from / 60)); endH = Math.max(endH, Math.ceil(s.to / 60)); }
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const height = (endH - startH) * HOUR_PX;

  const detail = h('div', { id: 'block-detail', class: 'block-detail muted' }, '블록을 누르면 그 실행 기록이 여기에 보입니다.');
  const showDetail = (s) => {
    detail.className = 'block-detail';
    detail.replaceChildren(
      h('b', {}, `#${s.task?.id} `, s.task?.title || '(삭제된 할 일)'), ' ', ...(s.task?.tags || []).map(tagChip),
      h('div', {}, `${fmtRange(s.run)} · 실제 ${s.run.actual_minutes}분`),
      s.run.blocker ? h('div', { class: 'blocker' }, '막힘: ', s.run.blocker) : null,
      h('a', { href: `#/plan/${p.id}` }, '할 일 목록에서 보기 →'));
  };

  const grid = h('div', { class: 'tt', id: 'timetable', css: { '--hours': hours.length, '--hour-px': `${HOUR_PX}px` } },
    h('div', { class: 'tt-corner' }),
    ...days.map((d) => h('div', { class: 'tt-day-head' + (d === today ? ' today' : '') + (d < p.period_start || d > p.period_end ? ' out' : '') },
      h('span', {}, WEEKDAYS[weekdayOf(d)]), h('b', {}, d.slice(5).replace('-', '/')))),
    h('div', { class: 'tt-hours', css: { height: `${height}px` } }, ...hours.map((x) => h('span', { css: { top: `${(x - startH) * HOUR_PX}px` } }, `${String(x).padStart(2, '0')}:00`))),
    ...days.map((d) => h('div', { class: 'tt-col' + (d === today ? ' today' : ''), css: { height: `${height}px` }, 'data-date': d },
      ...segs.filter((s) => s.date === d).map((s) => {
        const top = (s.from - startH * 60) / 60 * HOUR_PX, ht = Math.max(20, (s.to - s.from) / 60 * HOUR_PX - 2);
        return h('button', { type: 'button', class: 'tt-block' + (s.run.blocker ? ' blocked' : '') + (ht < 46 ? ' short' : ''), 'data-run': s.run.id,
          title: `${s.task?.title || ''} ${hm(s.from)}–${hm(s.to)}`,
          css: { top: `${top}px`, height: `${ht}px`, '--c': colorOf(s.tag) }, onclick: () => showDetail(s) },
          h('b', {}, s.task?.title || '(삭제된 할 일)'),
          h('span', {}, `${hm(s.from)}–${hm(s.to)} · ${s.run.actual_minutes}분${s.run.blocker ? ' · 막힘' : ''}`));
      }))),
    h('div', { class: 'tt-foot-label' }, '합계'),
    ...days.map((d) => {
      const m = [...new Set(segs.filter((s) => s.date === d).map((s) => s.run))].reduce((a, r) => a + r.actual_minutes, 0);
      return h('div', { class: 'tt-foot' + (m ? '' : ' zero') }, m ? fmtHm(m) : '-');
    }));

  // 태그별 합계와 색 바꾸기
  const tagTotals = {};
  for (const r of runsInWeek) { const t = tasksById[r.task_id]?.tags?.[0] || '태그 없음'; tagTotals[t] = (tagTotals[t] || 0) + r.actual_minutes; }
  const allTags = [...new Set(tasks.flatMap((t) => t.tags))];
  const weekTotal = runsInWeek.reduce((a, r) => a + r.actual_minutes, 0);
  const legend = card({ id: 'tag-legend' }, '태그별 시간 · 색 바꾸기',
    h('p', { class: 'muted' }, '블록 색은 할 일의 첫 번째 태그 색입니다. 색을 누르면 바꿀 수 있고, 서버에 저장되어 어디서 열어도 같은 색으로 보입니다.'),
    h('ul', { class: 'legend' }, ...allTags.map((g) => h('li', {},
      h('input', { type: 'color', value: colorOf(g), 'aria-label': `${g} 태그 색`, onchange: guard(async (e) => {
        await api('tag-colors', { method: 'PUT', body: { tag: g, color: e.target.value } });
        toast(`'${g}' 태그 색을 바꿨습니다`); route();
      }) }),
      tagChip(g), h('span', { class: 'muted' }, tagTotals[g] ? fmtHm(tagTotals[g]) : '0분')))));

  const nav = h('div', { class: 'row week-nav' },
    ...weeks.map((w) => h('a', { class: 'chip' + (w.n === cur.n ? ' on' : ''), href: `#/plan/${p.id}/week?week=${w.n}` }, `${w.n}주차 (${w.from.slice(5)} ~ ${w.to.slice(5)})`)));

  render(planHeader(p, 'week'),
    card({ id: 'week' }, `주간 타임테이블 · ${cur.n}주차`,
      nav,
      h('p', { class: 'muted' }, `${cur.from} ~ ${addDays(cur.from, 6)} · 이번 주 실제 ${fmtHm(weekTotal)} · 실행 기록 ${runsInWeek.length}건 · 시각은 서울 기준`),
      h('div', { class: 'tt-wrap' }, grid),
      detail),
    legend);
}

// ---------- 월간 캘린더 ----------
async function calendarPage(pid, q) {
  const [{ plan: p }, { runs }, { tasks }] = await Promise.all([api(`plans/${pid}`), api(`runs?plan_id=${pid}`), api(`tasks?plan_id=${pid}`)]);
  assignDefaults(tasks.flatMap((t) => t.tags));
  const today = todaySeoul();
  const month =/^\d{4}-\d{2}$/.test(q.month || '') ? q.month : (today >= p.period_start && today <= p.period_end ? today : p.period_start).slice(0, 7);
  const first = month + '-01';
  const [y, m] = month.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const start = addDays(first, -weekdayOf(first)); // 그 달 1일이 있는 주의 일요일
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const tasksById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const minutesByDay = {}, runsByDay = {};
  for (const r of runs) { const d = seoulParts(r.started_at).date; minutesByDay[d] = (minutesByDay[d] || 0) + r.actual_minutes; (runsByDay[d] ||= []).push(r); }
  const dueByDay = tasks.reduce((acc, t) => ((acc[t.due_date] ||= []).push(t), acc), {});
  const sel = /^\d{4}-\d{2}-\d{2}$/.test(q.day || '') ? q.day : (today.startsWith(month) ? today : null);
  const link = (extra) => `#/plan/${p.id}/calendar?${new URLSearchParams({ month, ...extra })}`;

  const grid = h('div', { class: 'cal', id: 'calendar' },
    ...WEEKDAYS.map((w, i) => h('div', { class: 'cal-head' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, w)),
    ...cells.map((d) => {
      const due = dueByDay[d] || [], mins = minutesByDay[d] || 0;
      const cls = ['cal-cell', d.startsWith(month) ? '' : 'other', d >= p.period_start && d <= p.period_end ? 'in-plan' : '', d === today ? 'today' : '', d === sel ? 'sel' : ''].filter(Boolean).join(' ');
      return h('a', { class: cls, href: link({ day: d }), 'data-date': d },
        h('span', { class: 'cal-date' }, String(Number(d.slice(8)))),
        mins ? h('span', { class: 'cal-mins' }, `공부 ${fmtHm(mins)}`) : null,
        ...due.slice(0, 3).map((t) => h('span', { class: 'cal-task' + (t.status === 'done' ? ' done' : ''), css: { '--c': colorOf(t.tags[0]) } }, t.title)),
        due.length > 3 ? h('span', { class: 'muted cal-more' }, `외 ${due.length - 3}건`) : null);
    }));

  let dayPanel = null;
  if (sel) {
    const due = dueByDay[sel] || [], dayRuns = runsByDay[sel] || [];
    dayPanel = card({ id: 'day-detail' }, `${sel} (${WEEKDAYS[weekdayOf(sel)]})`,
      h('h3', {}, `마감인 할 일 ${due.length}건`),
      due.length ? h('ul', { class: 'plain' }, ...due.map((t) => h('li', {}, h('span', { class: `badge ${t.status === 'done' ? 'done' : t.due_date < today ? 'late' : ''}` }, t.status === 'done' ? '완료' : t.due_date < today ? '지연' : '진행 중'), ' ', `#${t.id} `, t.title, ' ', ...t.tags.map(tagChip))))
        : h('p', { class: 'muted' }, '없음'),
      h('h3', {}, `실행 기록 ${dayRuns.length}건 · ${fmtHm(minutesByDay[sel] || 0)}`),
      dayRuns.length ? h('ul', { class: 'plain' }, ...dayRuns.map((r) => h('li', {}, `${hm(seoulParts(r.started_at).min)}–${hm(seoulParts(r.ended_at).min)} · `, `#${r.task_id} ${tasksById[r.task_id]?.title || r.task_title} · ${r.actual_minutes}분`, r.blocker ? h('span', { class: 'blocker' }, ' · 막힘: ', r.blocker) : null)))
        : h('p', { class: 'muted' }, '없음'),
      h('p', {}, h('a', { href: `#/plan/${p.id}/week?week=${Math.floor((Date.parse(sel) - Date.parse(p.period_start)) / 604800000) + 1}` }, '이 주 타임테이블 보기 →')));
  }

  render(planHeader(p, 'calendar'),
    card({ id: 'month' }, null,
      h('div', { class: 'cal-nav' },
        h('a', { class: 'btn ghost', href: `#/plan/${p.id}/calendar?month=${prevMonth}`, 'aria-label': '이전 달' }, '‹'),
        h('h2', {}, `${y}년 ${m}월`),
        h('a', { class: 'btn ghost', href: `#/plan/${p.id}/calendar?month=${nextMonth}`, 'aria-label': '다음 달' }, '›')),
      h('p', { class: 'muted' }, '색칠된 날 = 계획 기간 · 날짜 칸에 마감인 할 일(좁은 화면에서는 태그 색 점)과 그날 공부한 시간이 보입니다 · 날짜를 누르면 자세히'),
      grid),
    dayPanel);
}

// ---------- 회고 ----------
// [키, 이름, 큰 글씨, 작은 글씨]
const METRICS = [
  ['planned', '계획 수', (s) => `${s.planned}건`],
  ['done', '완료 수', (s) => `${s.done}건`],
  ['delayed', '지연 수', (s) => `${s.delayed}건`],
  ['blocked', '막힘 수', (s) => `${s.blocked}건`],
  ['estimated', '예상 시간', (s) => `${s.estimated_minutes}분`, (s) => fmtHm(s.estimated_minutes)],
  ['actual', '실제 시간', (s) => `${s.actual_minutes}분`, (s) => fmtHm(s.actual_minutes)],
  ['diff', '차이(실제−예상)', (s) => `${s.diff_minutes > 0 ? '+' : ''}${s.diff_minutes}분`, (s) => fmtHm(s.diff_minutes)],
];

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

  const scopeNav = h('div', { class: 'row', id: 'scope' }, h('span', { class: 'muted' }, '범위'),
    h('a', { class: 'chip' + (week ? '' : ' on'), href: link({ week: '', show }) }, '계획 전체'),
    ...weeks.map((w) => h('a', { class: 'chip' + (String(w.n) === week ? ' on' : ''), href: link({ week: String(w.n), show }) }, w.label)));

  const tiles = card({ id: 'stats' }, '회고 집계',
    scopeNav,
    h('p', { class: 'muted' }, `${scopeLabel} · 서울 기준 오늘 ${stats.today_seoul} · 시간 단위: 분 · 숫자를 누르면 근거 기록이 아래에 열립니다`),
    h('div', { class: 'stats' }, ...METRICS.map(([k, label, fmt, sub]) =>
      h('a', { class: 'stat' + (show === k ? ' on' : '') + (k === 'diff' ? (stats.diff_minutes > 0 ? ' over' : ' under') : ''), href: link({ show: k }), 'data-metric': k },
        h('span', {}, label), h('b', {}, fmt(stats)), sub ? h('small', { class: 'muted' }, sub(stats)) : null))));

  const evidence = ev ? evidenceCard(ev, stats, link) : null;

  const form = h('form', { id: 'review-form', class: 'row', onsubmit: guard(async (e) => {
    const d = formData(e.target);
    const msg = `회고를 저장할까요?\n범위: ${scopeLabel}\n개선점: ${d.improvement}\n\n지금의 집계 값이 함께 저장되며, 회고는 고치거나 지울 수 없습니다.`;
    if (!confirm(msg)) return;
    await api('reviews', { method: 'POST', body: { plan_id: p.id, week: week || undefined, improvement: d.improvement } });
    toast('회고를 저장했습니다'); route();
  }) },
    field(`다음 계획에 반영할 개선점 한 줄 (범위: ${scopeLabel})`, h('input', { name: 'improvement', required: true, maxlength: 300 }), 'grow'),
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
            h('td', { class: 'muted small' }, `계획 ${sn.planned} · 완료 ${sn.done} · 지연 ${sn.delayed} · 막힘 ${sn.blocked} · 예상 ${sn.estimated_minutes} · 실제 ${sn.actual_minutes} · 차이 ${sn.diff_minutes}분 (오늘 ${sn.today_seoul})`),
            h('td', {}, ...nextOf(r.id).map((n) => h('div', {}, h('a', { href: `#/plan/${n.id}` }, `계획 #${n.id} `, n.title))),
              h('a', { class: 'small', href: `#/?from_review=${r.id}` }, '이 개선점으로 다음 계획 만들기')));
        }))))
    : h('p', { class: 'muted' }, '아직 저장한 회고가 없습니다.');

  render(planHeader(p, 'review'),
    tiles, evidence,
    card({ id: 'reviews' }, '회고 → 다음 계획', form, h('h3', {}, '저장한 회고'), list));
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
          h('td', { class: 'nowrap num' }, `${t.estimated_minutes}분`), h('td', { class: 'nowrap num' }, `${t.actual_minutes}분 (${t.run_count}건)`),
          h('td', { class: 'nowrap num' }, `${t.actual_minutes - t.estimated_minutes > 0 ? '+' : ''}${t.actual_minutes - t.estimated_minutes}분`)))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, `합계 ${ev.totals.count}건`),
          h('td', { class: 'num' }, `${ev.totals.estimated_minutes}분`), h('td', { class: 'num' }, `${ev.totals.actual_minutes}분`),
          h('td', { class: 'num' }, `${ev.totals.actual_minutes - ev.totals.estimated_minutes}분`)))))
    : h('p', { class: 'muted' }, '해당하는 할 일이 없습니다(0건).')) : null;

  const runTable = ev.runs ? (ev.runs.length
    ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, ...['기록', '할 일', '시작 ~ 종료', '실제', '막힘 사유'].map((x) => h('th', {}, x)))),
        h('tbody', {}, ...ev.runs.map((r) => h('tr', { 'data-run': r.id },
          h('td', {}, `#${r.id}`), h('td', {}, `#${r.task_id} `, r.task_title), h('td', { class: 'nowrap' }, fmtRange(r)),
          h('td', { class: 'nowrap num' }, `${r.actual_minutes}분`), h('td', {}, r.blocker || '-'))))))
    : h('p', { class: 'muted' }, '해당하는 실행 기록이 없습니다(0건).')) : null;

  return h('section', { class: 'card', id: 'evidence', 'data-metric': ev.metric },
    h('div', { class: 'card-head' }, h('h2', {}, `근거: ${ev.label}`), h('a', { href: link({ show: '' }) }, '근거 닫기')),
    h('p', { class: 'muted' }, '규칙: ', ev.rule),
    check,
    ev.metric === 'blocked' ? h('h3', {}, '막힌 할 일') : null, taskTable,
    ev.metric === 'blocked' ? h('h3', {}, '막힘 사유가 적힌 실행 기록') : null, runTable);
}

// ---------- 실행 기록 ----------
const fmtRange = (r) => `${fmtTs(r.started_at)} ~ ${fmtTs(r.ended_at)}`;

function runsCard(runs) {
  const total = runs.reduce((a, r) => a + r.actual_minutes, 0);
  return card({ id: 'runs' }, `실행 기록 · ${runs.length}건`,
    h('p', { class: 'muted' }, `시각은 서울 시간 · 실제 시간 합계 ${fmtMin(total)} · 기록은 추가만 할 수 있습니다(계획·할 일 값은 바뀌지 않음)`),
    runs.length
      ? h('div', { class: 'scroll' }, h('table', {},
          h('thead', {}, h('tr', {}, ...['기록', '할 일', '시작 ~ 종료', '실제', '막힘 사유'].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...runs.map((r) => h('tr', { 'data-run': r.id },
            h('td', {}, `#${r.id}`),
            h('td', {}, h('a', { href: `#task-${r.task_id}`, onclick: (e) => { e.preventDefault(); document.querySelector(`tr[data-task="${r.task_id}"]`)?.scrollIntoView({ block: 'center' }); } }, `#${r.task_id} `, r.task_title)),
            h('td', { class: 'nowrap' }, fmtRange(r)),
            h('td', { class: 'nowrap num' }, fmtMin(r.actual_minutes)),
            h('td', {}, r.blocker ? h('span', { class: 'blocker' }, r.blocker) : '-'))))))
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

  const filters = h('form', { id: 'task-filter', class: 'toolbar', onsubmit: (e) => { e.preventDefault(); go(formData(e.target)); } },
    field('검색(제목·태그)', h('input', { name: 'q', value: tq.q, maxlength: 100, type: 'search' }), 'grow'),
    field('상태', h('select', { name: 'status' }, opt('', '전체', tq.status), opt('open', '진행 중', tq.status), opt('done', '완료', tq.status))),
    field('우선순위', h('select', { name: 'priority' }, opt('', '전체', tq.priority), ...Object.entries(PRIO).map(([k, v]) => opt(k, v, tq.priority)))),
    field('정렬 기준', h('select', { name: 'sort' }, ...SORT_OPTIONS.map(([k, v]) => opt(k, v, tq.sort)))),
    field('방향', h('select', { name: 'dir' }, opt('asc', '오름차순', tq.dir), opt('desc', '내림차순', tq.dir))),
    h('div', { class: 'btns' }, h('button', { type: 'submit' }, '적용'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { location.hash = `#/plan/${p.id}`; } }, '초기화')));

  const today = todaySeoul();
  const rows = tasks.map((t) => {
    const late = t.status === 'open' && t.due_date < today;
    // 이 화면에서 이 할 일을 '완료'하려는 한 번의 의도 = 멱등성 키 하나. 두 번 눌러도 같은 키가 간다.
    const completeKey = crypto.randomUUID();
    const state = t.status === 'done' ? ['완료', 'done'] : late ? ['지연', 'late'] : ['진행 중', ''];
    return h('tr', { class: t.status === 'done' ? 'is-done' : '', 'data-task': t.id },
      h('td', { class: 'muted' }, t.id),
      h('td', { class: 't-title' }, h('span', { class: 'tt-name' }, t.title), h('div', { class: 'tags' }, ...t.tags.map(tagChip))),
      h('td', {}, h('span', { class: `badge ${state[1]}` }, state[0])),
      h('td', { class: 'nowrap' }, t.due_date),
      h('td', {}, h('span', { class: `prio prio-${t.priority}` }, PRIO[t.priority])),
      h('td', { class: 'nowrap num' }, fmtHm(t.estimated_minutes)),
      h('td', { class: 'actions' },
        h('div', { class: 'btns' },
          t.status === 'done'
            ? h('button', { class: 'ghost small', onclick: guard(async () => { await api(`tasks/${t.id}/reopen`, { method: 'POST' }); toast('진행 중으로 되돌렸습니다'); route(); }) }, '완료 취소')
            // 버튼을 막지 않는다: 두 번 눌러 요청이 두 번 가도 서버(키 + 유니크 제약)가 한 번만 기록한다
            : h('button', { class: 'small', 'data-complete': t.id, onclick: guard(async () => {
                const r = await api(`tasks/${t.id}/complete`, { method: 'POST', body: { idempotency_key: completeKey } });
                toast(r.created ? '완료했습니다' : '이미 완료된 요청입니다(기록은 1건)');
                if (r.created) route();
              }) }, '완료'),
          h('button', { class: 'danger small', onclick: guard(async () => {
            if (!confirm(`할 일 #${t.id} "${t.title}"을(를) 삭제할까요?`)) return;
            await api(`tasks/${t.id}`, { method: 'DELETE' }); toast('삭제했습니다'); route();
          }) }, '삭제')),
        taskEdit(t, dateRange),
        taskLog(t, p, ctx.runsByTask[t.id], ctx.completionsByTask[t.id])));
  });

  const addForm = h('form', { id: 'task-form', class: 'toolbar', onsubmit: guard(async (e) => {
    await api('tasks', { method: 'POST', body: { ...toTaskBody(formData(e.target)), plan_id: p.id } });
    toast('할 일을 추가했습니다'); route();
  }) }, ...taskFields({}, dateRange), h('div', { class: 'btns' }, h('button', { type: 'submit' }, '할 일 추가')));

  return card({ id: 'tasks' }, '할 일',
    h('p', { class: 'muted', id: 'task-summary' }, `전체 ${summary.total}건 · 완료 ${summary.done}건 (검색·필터와 무관한 계획 전체 기준)`),
    filters,
    h('p', { class: 'sortline' }, '정렬 기준: ', h('b', { id: 'sort-label' }, sort.label), h('span', { class: 'muted' }, ` · ${tasks.length}건`)),
    tasks.length
      ? h('div', { class: 'scroll' }, h('table', { class: 'task-table' },
          h('thead', {}, h('tr', {}, ...['ID', '할 일', '상태', '마감일', '우선순위', '예상', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, ...rows)))
      : h('p', { class: 'muted empty' }, '조건에 맞는 할 일이 없습니다.'),
    h('details', { class: 'add', open: !tasks.length }, h('summary', {}, '+ 할 일 추가'), addForm));
}

function taskFields(t, range) {
  return [
    field('할 일', h('input', { name: 'title', required: true, maxlength: 200, value: t.title }), 'grow'),
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
    h('form', { class: 'toolbar', onsubmit: guard(async (e) => {
      await api(`tasks/${t.id}`, { method: 'PATCH', body: toTaskBody(formData(e.target)) });
      toast('할 일을 수정했습니다'); route();
    }) }, ...taskFields(t, range), h('div', { class: 'btns' }, h('button', { type: 'submit' }, '수정 저장'))));
}
