// 비밀값 노출·스크립트 삽입(XSS) 점검. 읽기만 한다(데이터를 만들거나 바꾸지 않음).
// 사용: BASE_URL=https://skt-aleph-task6.vercel.app node scripts/check-security.mjs
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

// 비밀값 패턴. 이 파일 자체가 걸리지 않도록 문자열을 쪼개 둔다.
const SECRET = new RegExp([
  'postgres(ql)?:\\/\\/[^\\s\'"`<>]*:[^\\s\'"`@<>\\[\\]]+@',    // 비밀번호가 들어 있는 DB 연결 문자열
  'sb_' + 'secret_[A-Za-z0-9_-]{10,}',                          // Supabase 비밀 키
  'sb_' + 'publishable_[A-Za-z0-9_-]{10,}',                     // Supabase 공개 키(이 앱은 쓰지 않으므로 나오면 안 됨)
  'eyJhbG' + 'ciOi[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.',  // JWT(service_role/anon)
  // 'DATABASE_URL=postgres://...' 같은 문서 예시는 비밀번호가 없어 첫 패턴에 걸리지 않는다
].join('|'));
const hit = (text) => { const m = String(text).match(SECRET); return m ? m[0].slice(0, 24) + '…' : null; };

// 1) 배포 파일과 네트워크 응답
const targets = ['/', '/app.js', '/style.css', '/api/health', '/api/plans', '/api/tasks?plan_id=1', '/api/runs?plan_id=1',
  '/api/plans/1/stats', '/api/plans/1/evidence?metric=planned', '/api/export',
  '/api/does-not-exist', '/api/tasks/abc', '/api/plans/1/stats?week=99'];  // 오류 응답도 포함
const leaks = [];
for (const path of targets) {
  const r = await fetch(BASE + path, { signal: AbortSignal.timeout(20_000) }); // 응답이 없으면 20초 뒤 실패로 끝냄
  const body = await r.text();
  const headers = [...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n');
  const found = hit(body) || hit(headers);
  if (found) leaks.push(`${path} → ${found}`);
  if (path === '/') {
    const csp = r.headers.get('content-security-policy') || '';
    check('CSP 헤더: 외부·인라인 스크립트 차단', /script-src 'self'/.test(csp) && !/unsafe-inline/.test(csp), csp.slice(0, 60));
  }
  if (r.status >= 500) leaks.push(`${path} → ${r.status} 서버 오류(내부 메시지 노출 여부 확인 필요)`);
}
check(`배포 파일·API 응답·오류 응답 ${targets.length}곳에 비밀값 없음`, leaks.length === 0, leaks.join(' / '));

// 2) 화면 코드가 사용자 입력을 HTML로 해석하지 않는지
const appJs = await (await fetch(BASE + '/app.js', { signal: AbortSignal.timeout(20_000) })).text();
const risky = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function'].filter((k) => appJs.includes(k));
check('화면 코드에 HTML 해석 API 없음(textContent로만 그림)', risky.length === 0, risky.join(', '));

// 3) 저장소 파일과 Git 이력 전체
try {
  const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const fileHits = files.filter((f) => !/\.(jpg|png)$/i.test(f) && f !== 'scripts/check-security.mjs').filter((f) => hit(readFileSync(f, 'utf8')));
  check(`저장소 파일 ${files.length}개에 비밀값 없음`, fileHits.length === 0, fileHits.join(', '));
  const history = execSync('git log -p --all -- . ":(exclude)scripts/check-security.mjs"', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const commits = execSync('git rev-list --all --count', { encoding: 'utf8' }).trim();
  check(`Git 이력(커밋 ${commits}개, 모든 변경 내용)에 비밀값 없음`, !hit(history), hit(history) || '');
  const env = files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'));
  check('.env 파일이 Git에 없음', env.length === 0, env.join(', '));
} catch (e) {
  check('Git 점검', false, e.message);
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} PASS (${BASE})`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
