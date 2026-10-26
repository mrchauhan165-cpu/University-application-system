-- =============================================================================
-- University Application System — schema
-- =============================================================================
-- PROVIDED AS A STARTING POINT FOR PRODUCTION. It has NOT been run against a
-- live database in this workspace (no PostgreSQL was available), so treat it as
-- a reviewed draft, apply it to a staging project first, and read the notes in
-- docs/HANDOVER.md before using it with real personal data.
--
-- What this file gives you:
--   * the same entities the working prototype uses (see src/domain/types.ts)
--   * enums, keys, foreign keys and check constraints that encode the rules
--   * append-only audit log, sequence-based reference numbers and user codes
--   * indexes for the queries the portal actually makes
--
-- What it does not give you: the business operations (submit, approve, forward,
-- retention …). Those live in TypeScript in src/backend/ops/*.ts and must be
-- ported to `security definer` RPCs (one function per operation) so that every
-- write goes through the same checks. Read that folder before writing them.
--
-- Apply with:  supabase db push      (or paste into the SQL editor, in order)
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- enumerations

create type user_kind as enum ('student', 'teacher', 'staff');
create type profile_status as enum ('invited', 'active', 'suspended');
create type post_scope as enum ('university', 'faculty', 'department', 'batch', 'section');
create type application_status as enum (
  'draft', 'submitted', 'under_review', 'returned', 'resubmitted',
  'further_pending', 'completed', 'rejected', 'withdrawn'
);
create type applicant_kind as enum ('student', 'teacher', 'staff');
create type notice_status as enum ('draft', 'scheduled', 'published', 'expired', 'archived');
create type notice_audience as enum ('everyone', 'students', 'staff');
create type batch_status as enum (
  'planned', 'active', 'graduated', 'archived', 'retention_review', 'deletion_approval', 'deleted'
);
create type retention_stage as enum ('initial_cleanup', 'final_deletion');
create type retention_status as enum ('proposed', 'awaiting_approval', 'approved', 'executed', 'declined');
create type workflow_status as enum ('active', 'retired');

-- ------------------------------------------------------------------ structure

create table faculties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  faculty_id uuid not null references faculties(id) on delete restrict,
  code text not null,
  name text not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (faculty_id, code)
);

create table batches (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references departments(id) on delete restrict,
  label text not null,
  start_year int not null check (start_year between 1900 and 2200),
  end_year int not null check (end_year >= start_year),
  status batch_status not null default 'active',
  graduated_on date,
  retention_months int not null default 12 check (retention_months >= 0),
  final_months int not null default 6 check (final_months >= 0),
  created_at timestamptz not null default now(),
  unique (department_id, label)
);

create table sections (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  unique (batch_id, name)
);

-- ---------------------------------------------------------------------- people

create table profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  user_code text not null unique,
  full_name text not null,
  email text not null unique,
  kind user_kind not null,
  status profile_status not null default 'invited',
  designation text,
  faculty_id uuid references faculties(id),
  department_id uuid references departments(id),
  batch_id uuid references batches(id),
  section_id uuid references sections(id),
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_needs_section check (kind <> 'student' or section_id is not null)
);

create index profiles_scope_idx on profiles (faculty_id, department_id, batch_id, section_id);

-- Numbering: readable, unique, collision-safe (sequence + format, never reused).
create sequence user_code_seq start 1;
create sequence application_ref_seq start 1;

create or replace function next_user_code(p_kind user_kind) returns text
language sql volatile as $$
  select case p_kind
    when 'student' then 'STU'
    when 'teacher' then 'TCH'
    else 'STF'
  end || lpad(nextval('user_code_seq')::text, 4, '0');
$$;

create or replace function next_application_reference() returns text
language sql volatile as $$
  select 'APP-' || to_char(now(), 'YYYY') || '-' ||
         lpad(nextval('application_ref_seq')::text, 5, '0');
$$;

-- ------------------------------------------------------------ posts & powers

-- Permission codes are data, not code: a new post needs no deployment.
create table permissions (
  code text primary key,
  label text not null,
  description text not null
);

insert into permissions (code, label, description) values
  ('application.submit', 'Submit applications', 'Create and submit applications of allowed types.'),
  ('application.view', 'View applications', 'Read applications that pass through the post, within its scope.'),
  ('application.act', 'Act on applications', 'Approve, reject, return, clarify or finalise at the current stage.'),
  ('document.view', 'View documents', 'Download attachments of readable applications.'),
  ('statistics.view', 'View statistics', 'See aggregated figures inside the post scope.'),
  ('notice.create', 'Publish notices', 'Create notices for the post scope.'),
  ('notice.university', 'Publish university-wide', 'Address notices to the whole university.'),
  ('user.manage', 'Manage users', 'Create accounts, activate, suspend and assign posts.'),
  ('workflow.configure', 'Configure workflows', 'Edit application types and approval routes.'),
  ('retention.manage', 'Manage retention', 'Propose, approve and execute retention jobs.'),
  ('audit.view', 'View audit log', 'Read the append-only audit log.'),
  ('system.admin', 'System administration', 'Settings, imports and exports.'),
  ('confidential.breakglass', 'Confidential access', 'Separately authorised access to confidential records (audited).');

create table posts (
  code text primary key,
  name text not null,
  scope_type post_scope not null,
  rank int not null default 100,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table post_permissions (
  post_code text not null references posts(code) on delete cascade,
  permission text not null references permissions(code) on delete cascade,
  primary key (post_code, permission)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete restrict,
  post_code text not null references posts(code) on delete restrict,
  faculty_id uuid references faculties(id),
  department_id uuid references departments(id),
  batch_id uuid references batches(id),
  section_id uuid references sections(id),
  starts_on date not null default current_date,
  ends_on date,
  ended_reason text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint assignment_dates check (ends_on is null or ends_on >= starts_on)
);

create index assignments_live_idx on assignments (post_code, user_id) where ends_on is null;

-- One current holder per post + scope (history stays in ended rows).
create unique index assignments_one_live_holder
  on assignments (post_code, coalesce(faculty_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  coalesce(batch_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  coalesce(section_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where ends_on is null;

-- --------------------------------------------------- application configuration

create table application_types (
  id text primary key,
  code text not null unique,
  name text not null,
  description text not null default '',
  applicant_kinds applicant_kind[] not null default '{student}',
  confidential boolean not null default false,
  allow_draft boolean not null default true,
  allow_withdraw boolean not null default false,
  fields jsonb not null default '[]'::jsonb,
  documents jsonb not null default '[]'::jsonb,
  retention_category text not null default 'standard',
  extra_viewer_posts text[] not null default '{}',
  fallback_approver_post text references posts(code),
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  constraint fields_is_array check (jsonb_typeof(fields) = 'array'),
  constraint documents_is_array check (jsonb_typeof(documents) = 'array')
);

create table workflow_versions (
  id text primary key,
  application_type_id text not null references application_types(id) on delete restrict,
  version int not null,
  stages jsonb not null,
  beyond_final jsonb,
  status workflow_status not null default 'active',
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (application_type_id, version),
  constraint stages_is_array check (jsonb_typeof(stages) = 'array')
);

-- Only one active version per type at a time.
create unique index workflow_one_active on workflow_versions (application_type_id) where status = 'active';

-- ------------------------------------------------------------- applications

create table applications (
  id text primary key,
  reference text not null unique default next_application_reference(),
  application_type_id text not null references application_types(id) on delete restrict,
  workflow_version_id text not null references workflow_versions(id) on delete restrict,
  applicant_id uuid not null references profiles(id) on delete restrict,
  applicant_name text not null,
  applicant_code text not null,
  applicant_kind applicant_kind not null,
  faculty_id uuid references faculties(id),
  department_id uuid references departments(id),
  batch_id uuid references batches(id),
  section_id uuid references sections(id),
  data jsonb not null default '{}'::jsonb,
  status application_status not null default 'draft',
  stage_index int not null default 0,
  current_post text references posts(code),
  beyond_active boolean not null default false,
  beyond_done boolean not null default false,
  post_codes_seen text[] not null default '{}',
  vc_approved boolean not null default false,
  confidential boolean not null default false,
  retention_category text not null default 'standard',
  submitted_at timestamptz,
  decided_at timestamptz,
  withdrawn_reason text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index applications_applicant_idx on applications (applicant_id, status);
create index applications_stage_idx on applications (current_post, status) where deleted_at is null;
create index applications_batch_idx on applications (batch_id);
create index applications_scope_idx on applications (faculty_id, department_id, section_id);

create table application_actions (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references applications(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text not null,
  actor_code text not null,
  post_code text,
  post_name text,
  assignment_id uuid references assignments(id),
  scope_label text,
  action text not null check (action in ('submit','resubmit','approve','reject','return','clarify','forward','finalise','approve_forward','remark','withdraw','reassign','handover','system_skip')),
  from_status application_status,
  to_status application_status not null,
  remarks_internal text,
  remarks_applicant text,
  created_at timestamptz not null default now()
);

create index application_actions_app_idx on application_actions (application_id, created_at);

create table status_events (
  id uuid primary key default gen_random_uuid(),
  application_id text not null references applications(id) on delete cascade,
  status application_status not null,
  label text not null,
  visible boolean not null default true,
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------- documents

-- Files live in a PRIVATE storage bucket; only metadata is stored here.
create table documents (
  id uuid primary key default gen_random_uuid(),
  application_id text references applications(id) on delete cascade,
  notice_id text,
  doc_key text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 3145728),
  storage_path text not null unique,
  checksum text,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  constraint document_owner check (application_id is not null or notice_id is not null),
  constraint no_executables check (
    mime_type in ('application/pdf','image/png','image/jpeg','image/webp','text/plain')
  )
);

-- ---------------------------------------------------------- notices & inbox

create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 200),
  body text not null check (char_length(body) between 3 and 20000),
  status notice_status not null default 'draft',
  scope_type post_scope not null,
  faculty_id uuid references faculties(id),
  department_id uuid references departments(id),
  batch_id uuid references batches(id),
  section_id uuid references sections(id),
  scope_label text not null,
  audience notice_audience not null default 'everyone',
  publish_at timestamptz,
  expires_at timestamptz,
  created_by uuid not null references profiles(id),
  creator_name text not null,
  creator_code text not null,
  creator_post text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notice_window check (expires_at is null or publish_at is null or expires_at > publish_at)
);

alter table documents
  add constraint documents_notice_fk foreign key (notice_id) references notices(id) on delete cascade;

create table notice_reads (
  notice_id uuid not null references notices(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, user_id)
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  link text,
  category text not null default 'system',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Duplicate notifications for the same event are impossible.
create unique index notifications_dedupe on notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_unread_idx on notifications (user_id, read_at);

-- ---------------------------------------------------------------- audit log

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id) on delete set null,
  actor_name text not null,
  action text not null,
  entity text not null,
  entity_id text,
  meta jsonb,
  created_at timestamptz not null default now()
);

create index audit_created_idx on audit_log (created_at desc);

create or replace function audit_log_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log is append-only.';
end;
$$;

create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_immutable();

-- ---------------------------------------------------------------- retention

create table retention_jobs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete restrict,
  stage retention_stage not null,
  status retention_status not null default 'awaiting_approval',
  dry_run jsonb,
  requested_by uuid not null references profiles(id),
  approved_by uuid references profiles(id),
  approval_note text,
  decline_note text,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint four_eyes check (approved_by is null or approved_by <> requested_by)
);

create table legal_holds (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  reason text not null,
  created_by uuid not null references profiles(id),
  released_at timestamptz,
  released_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table deletion_audits (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null,
  batch_label text not null,
  stage retention_stage not null,
  outcome text not null,
  counts jsonb not null default '{}'::jsonb,
  approved_by_name text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- settings

create table settings (
  id boolean primary key default true check (id),
  university_name text not null default 'Your University',
  university_short text not null default 'YU',
  support_email text not null default 'support@example.edu',
  timezone text not null default 'UTC',
  retention_months int not null default 12,
  final_retention_months int not null default 6,
  mfa_required_for_privileged boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into settings (id) values (true);

-- ------------------------------------------------------------ housekeeping

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on profiles
  for each row execute function touch_updated_at();
create trigger applications_touch before update on applications
  for each row execute function touch_updated_at();
create trigger notices_touch before update on notices
  for each row execute function touch_updated_at();
