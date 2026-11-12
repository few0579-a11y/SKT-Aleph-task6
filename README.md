# Plan-Do-See 다이어리 (ALEPH T06)

계획(Plan) → 할 일·실행 기록(Do) → 회고(See) → 다음 계획으로 이어지는 다이어리입니다.
지금은 **카드 1(계획 등록과 수정 이력 보존)**까지 구현되어 있습니다.

- 소스: https://github.com/few0579-a11y/SKT-Aleph-task6

## 구조
| 경로 | 역할 |
|---|---|
| `public/` | 화면(순수 HTML/CSS/JS). 사용자 입력은 `textContent`로만 그린다 |
| `api/router.js` | Vercel 서버 함수. `/api/*` 요청을 `lib/handler.mjs`로 넘긴다 |
| `lib/handler.mjs` | API 로직과 입력 검증 |
| `db/schema.sql` | 테이블·트리거·RLS. Supabase SQL Editor에서 실행 |
| `server.mjs` | 로컬 실행용 서버 |

## 데이터 규칙
- 날짜(`date`)는 서울 달력 날짜 `YYYY-MM-DD` 그대로 저장·표시한다.
- 시각(`timestamptz`)은 UTC로 저장하고 화면에서 서울 시간으로 표시한다.
- 시간 수치는 모두 **분** 단위 정수다.

## 계획 수정 이력
- `plans`에는 현재 값, `plan_revisions`에는 모든 버전을 쌓는다(v1 = 최초 계획).
- 이력은 DB 트리거가 생성·수정 때마다 자동으로 남기고, 이력의 수정·삭제는 DB가 막는다.
- 계획을 수정해도 계획 ID는 바뀌지 않는다.

## API
- `GET /api/plans`, `POST /api/plans`
- `GET /api/plans/:id`, `PATCH /api/plans/:id`
- `GET /api/plans/:id/revisions`
- `GET /api/health`

## 비밀값
- DB 연결 문자열(`DATABASE_URL`)은 Vercel 환경변수에만 둔다. 브라우저는 `/api/*`만 부르며 DB 키를 받지 않는다.
- `.env`는 Git에서 제외한다(`.gitignore`).
- Supabase Data API는 꺼 두었고, 모든 테이블에 RLS를 켜고 정책은 두지 않았다.

## 로컬 실행
```bash
npm install
DATABASE_URL=postgres://... node server.mjs   # http://localhost:3000
```
