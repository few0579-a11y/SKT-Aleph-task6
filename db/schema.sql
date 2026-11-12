-- T06 Plan-Do-See 다이어리 스키마 (PostgreSQL / Supabase)
-- 규칙: date 컬럼은 서울 달력 날짜(YYYY-MM-DD) 그대로, timestamptz는 UTC 저장·서울 표시, 시간 수치는 모두 "분" 정수.
-- Supabase SQL Editor에 전체를 붙여 넣고 실행합니다. 다시 실행해도 안전합니다.

-- ===== 카드 1: 계획과 수정 이력 =====

-- 현재 계획 값. 수정해도 id는 그대로이고 revision만 1씩 늘어난다.
create table if not exists plans (
  id                bigint generated always as identity primary key,
  title             text not null check (length(title) between 1 and 200),
  period_start      date not null,
  period_end        date not null,
  priority          text not null check (priority in ('high', 'medium', 'low')),
  success_criteria  text not null check (length(success_criteria) between 1 and 1000),
  estimated_minutes integer not null check (estimated_minutes >= 0),
  revision          integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (period_end >= period_start)
);

-- 계획의 모든 버전(revision 1 = 최초 계획)을 쌓는다. 수정·삭제 불가.
create table if not exists plan_revisions (
  id        bigint generated always as identity primary key,
  plan_id   bigint not null references plans(id),
  revision  integer not null,
  snapshot  jsonb not null,
  saved_at  timestamptz not null default now(),
  unique (plan_id, revision)
);

-- 수정 전: revision +1, id·created_at은 바꿀 수 없게 고정
create or replace function plans_before_update() returns trigger language plpgsql as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists plans_before_update on plans;
create trigger plans_before_update before update on plans
  for each row execute function plans_before_update();

-- 생성·수정 후: 그 버전 전체를 이력에 추가
create or replace function plans_save_revision() returns trigger language plpgsql as $$
begin
  insert into plan_revisions (plan_id, revision, snapshot) values (new.id, new.revision, to_jsonb(new));
  return null;
end $$;
drop trigger if exists plans_save_revision on plans;
create trigger plans_save_revision after insert or update on plans
  for each row execute function plans_save_revision();

-- 이력은 고치거나 지울 수 없다
create or replace function plan_revisions_block() returns trigger language plpgsql as $$
begin
  raise exception 'plan_revisions는 추가만 할 수 있습니다';
end $$;
drop trigger if exists plan_revisions_block on plan_revisions;
create trigger plan_revisions_block before update or delete on plan_revisions
  for each row execute function plan_revisions_block();

-- ===== 카드 2: 할 일 =====

-- 계획에 속한 할 일. 반복 활동은 결과 단위 할 일 하나 + 실행 기록 여러 개로 담는다.
-- 삭제는 소프트 삭제(deleted_at). 목록·집계에서 빼고 행은 남긴다.
create table if not exists tasks (
  id                bigint generated always as identity primary key,
  plan_id           bigint not null references plans(id),
  title             text not null check (length(title) between 1 and 200),
  due_date          date not null,          -- 계획 기간 안인지는 API에서 검사
  priority          text not null check (priority in ('high', 'medium', 'low')),
  tags              text[] not null default '{}',
  estimated_minutes integer not null check (estimated_minutes >= 0),
  status            text not null default 'open' check (status in ('open', 'done')),
  completed_at      timestamptz,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((status = 'done') = (completed_at is not null))
);
create index if not exists tasks_plan_idx on tasks (plan_id) where deleted_at is null;

-- Supabase 공개 REST(anon 키)로는 접근할 수 없게 RLS만 켜고 정책은 두지 않는다.
-- 앱은 Vercel 서버 함수에서 DATABASE_URL로만 접근한다.
alter table plans enable row level security;
alter table plan_revisions enable row level security;
alter table tasks enable row level security;
