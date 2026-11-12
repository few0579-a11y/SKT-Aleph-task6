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
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  app.replaceChildren(h('p', { class: 'muted' }, '불러오는 중…'));
  try {
    if (parts[0] === 'plan' && parts[1]) await planPage(parts[1]);
    else await homePage();
  } catch (e) {
    app.replaceChildren(h('p', { class: 'err' }, '오류: ' + e.message));
  }
}

// ---------- 계획 목록 + 새 계획 ----------
async function homePage() {
  const { plans } = await api('plans');
  const list = h('section', { class: 'card' },
    h('h2', {}, `계획 ${plans.length}개`),
    plans.length
      ? h('table', {},
          h('thead', {}, h('tr', {}, ...['ID', '제목', '기간', '우선순위', '예상 시간', '버전'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...plans.map((p) => h('tr', {},
            h('td', {}, p.id),
            h('td', {}, h('a', { href: `#/plan/${p.id}` }, p.title)),
            h('td', {}, `${p.period_start} ~ ${p.period_end}`),
            h('td', {}, PRIO[p.priority]),
            h('td', {}, fmtMin(p.estimated_minutes)),
            h('td', {}, `v${p.revision}`)))))
      : h('p', { class: 'muted' }, '아직 계획이 없습니다. 지금 실제로 하고 있는 일 하나를 아래에서 등록하세요.'));

  const form = h('form', { id: 'plan-form', class: 'card', onsubmit: guard(async (e) => {
    const { plan } = await api('plans', { method: 'POST', body: toBody(formData(e.target)) });
    toast('계획을 저장했습니다');
    location.hash = `#/plan/${plan.id}`;
  }) },
    h('h2', {}, '새 계획 등록'),
    ...planFields(),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, '계획 저장')));

  app.replaceChildren(h('h1', {}, '계획'), list, form);
}

// ---------- 계획 상세: 현재 값 · 수정 · 이력 ----------
async function planPage(pid) {
  const [{ plan: p }, { revisions }] = await Promise.all([api(`plans/${pid}`), api(`plans/${pid}/revisions`)]);

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
    h('p', {}, h('a', { href: '#/' }, '← 계획 목록')),
    h('h1', {}, `계획 #${p.id} · `, p.title),
    current, edit, history);
}
