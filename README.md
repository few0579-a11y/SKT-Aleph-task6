# Plan-Do-See 다이어리 (ALEPH T06)

계획(Plan) → 할 일·실행 기록(Do) → 회고(See) → 다음 계획으로 이어지는 다이어리입니다.

- 결과물: https://skt-aleph-task6.vercel.app
- 소스: https://github.com/few0579-a11y/SKT-Aleph-task6
- 제출 정보·확인 방법: [docs/SUBMISSION.md](docs/SUBMISSION.md)
- 증거 화면: [docs/evidence/](docs/evidence/README.md)

> 지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다. 남이 봐도 괜찮은 내용만 넣으세요. (접근 제어는 T07에서 적용)

## 구조
| 경로 | 역할 |
|---|---|
| `public/` | 화면(순수 HTML/CSS/JS). 사용자 입력은 `textContent`로만 그린다 |
| `api/router.js` | Vercel 서버 함수. `/api/*` 요청을 `lib/handler.mjs`로 넘긴다 |
| `lib/handler.mjs` | API 로직, 입력 검증, 집계·근거 |
| `db/schema.sql` | 테이블·트리거·함수·RLS. Supabase SQL Editor에서 실행(다시 실행해도 안전) |
| `contracts/pds-schema-v2.json` | 테이블·컬럼·관계·날짜 규칙·집계 규칙 계약 |
| `scripts/check-contract.mjs` | 계약과 실제 DB 구조 대조(읽기 전용) |
| `scripts/check-security.mjs` | 비밀값 노출·XSS 점검(읽기 전용) |
| `server.mjs` | 로컬 실행용 서버 |

## 카드별 구현
1. **계획과 수정 이력**: `plans`(현재 값) + `plan_revisions`(모든 버전, v1 = 최초 계획). DB 트리거가 이력을 쌓고, 이력 수정·삭제와 ID 변경을 막는다.
2. **할 일**: 생성·수정·완료·완료 취소·소프트 삭제. 마감일(계획 기간 안)·우선순위·태그·예상 시간. 검색(제목 일부·태그)·필터(상태·우선순위)·정렬은 서버에서, 정렬은 항상 ID 오름차순을 보조 기준으로 붙이고 그 기준을 화면에 표시한다.
3. **실행 기록과 중복 완료 방지**: `runs`(시작·종료·실제 시간·막힘 사유, 추가만 가능, 계획 값을 바꾸지 않음). 완료는 화면이 만든 멱등성 키 + DB 유니크 제약(할 일당 유효 완료 1건)으로 한 번만 기록한다. 버튼 비활성화에 의존하지 않는다.
4. **회고**: 계획 전체·주차별 집계(계획·완료·지연·막힘·예상·실제·차이). 숫자를 누르면 같은 조건으로 뽑은 근거 기록이 열리고 일치 여부를 표시한다. 회고(개선점 + 저장 시점 집계)에서 다음 계획을 만들면 회고 ID와 개선점이 연결된다.
5. **공개 범위 안내·내보내기**: 모든 화면 맨 위 안내 문구, 전체 데이터를 JSON 파일 하나로 내보내기(`/api/export`).
6. **타임테이블·캘린더**: 계획 화면 탭(개요·할 일 / 타임테이블 / 캘린더 / 회고). 주간 타임테이블은 실행 기록을 요일×시간 블록으로 보여 주고(하루를 어떻게 썼는지), 태그별 색을 바꿔 서버(`tag_colors`)에 저장할 수 있다. 월간 캘린더는 계획 기간, 날짜별 마감 할 일과 공부 시간을 보여 준다.

## 규칙
- 날짜(`date`)는 서울 달력 날짜 `YYYY-MM-DD` 그대로, 시각(`timestamptz`)은 UTC 저장·서울 표시, 시간 수치는 모두 **분**.
- 지연 판단의 오늘 = 서울 기준 오늘.
- 자세한 규칙은 [contracts/pds-schema-v2.json](contracts/pds-schema-v2.json).

## API
- 계획: `GET/POST /api/plans`, `GET/PATCH /api/plans/:id`, `GET /api/plans/:id/revisions`
- 할 일: `GET /api/tasks?plan_id&q&status&priority&sort&dir`, `POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`
- 완료: `POST /api/tasks/:id/complete` (body `idempotency_key`: UUID), `POST /api/tasks/:id/reopen`, `GET /api/tasks/:id/completions`, `GET /api/completions?plan_id`
- 실행 기록: `GET /api/runs?plan_id&task_id`, `POST /api/runs`
- 회고: `GET /api/plans/:id/stats?week`, `GET /api/plans/:id/evidence?metric&week`, `GET /api/plans/:id/reviews`, `POST /api/reviews`, `GET /api/reviews/:id`
- 태그 색: `GET /api/tag-colors`, `PUT /api/tag-colors` (body `tag`, `color`: `#rrggbb`)
- 내보내기: `GET /api/export`

## 비밀값
- DB 연결 문자열(`DATABASE_URL`)은 Vercel 환경변수(Sensitive)에만 둔다. 브라우저는 `/api/*`만 부르며 DB 키를 받지 않는다.
- `.env`는 Git에서 제외한다. Supabase Data API는 꺼 두었고 모든 테이블에 RLS를 켜고 정책은 두지 않았다.
- 점검: `BASE_URL=https://skt-aleph-task6.vercel.app node scripts/check-security.mjs`

## 로컬 실행
```bash
npm install
DATABASE_URL=postgres://... node server.mjs        # http://localhost:3000
DATABASE_URL=postgres://... node scripts/check-contract.mjs
```

## 알려진 한계
로그인이 없으므로 링크를 아는 사람은 데이터를 **추가·수정할 수도** 있습니다. 실행 기록·회고·계획 이력은 지워지지 않고, 할 일 삭제는 소프트 삭제이며, 내보내기로 백업할 수 있습니다. 쓰기 제한은 T07에서 적용합니다.
