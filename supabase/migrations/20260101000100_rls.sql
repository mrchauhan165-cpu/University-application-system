-- =============================================================================
-- Row Level Security, private storage and read-side helpers
-- =============================================================================
-- Defence in depth: the UI is only a view. Every row a person can read is
-- decided here, in the database, from their *current* post assignments.
--
-- IMPORTANT — writes
--   This migration grants SELECT only. All mutations must go through
--   `security definer` RPCs that re-implement the checks in
--   src/backend/ops/*.ts (submit, act, notice publishing, retention, …).
--   Granting INSERT/UPDATE to clients would let a browser bypass those rules.
--
-- Untested against a live project in this workspace — apply to staging first.
-- =============================================================================

-- ------------------------------------------------------------- helper functions

create or replace function current_profile_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function has_permission(p_permission text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from assignments a
    join post_permissions pp on pp.post_code = a.post_code
    where a.user_id = current_profile_id()
      and a.ends_on is null
      and pp.permission = p_permission
  );
$$;

-- Does the assignment scope contain the target scope? A broader scope covers a
-- narrower one; a narrower scope never covers a broader one.
create or replace function scope_covers(
  a_faculty uuid, a_department uuid, a_batch uuid, a_section uuid,
  t_faculty uuid, t_department uuid, t_batch uuid, t_section uuid
) returns boolean
language sql immutable as $$
  select case
    when a_section is not null then a_section = t_section
    when a_batch is not null then a_batch = t_batch
    when a_department is not null then a_department = t_department
    when a_faculty is not null then a_faculty = t_faculty
    else true
  end;
$$;

-- Confidential records: the holder of the post that must act, or a separately
-- authorised break-glass holder. Administrators are NOT included.
create or replace function can_read_application(
  p_applicant uuid, p_confidential boolean, p_current_post text, p_post_codes_seen text[],
  p_faculty uuid, p_department uuid, p_batch uuid, p_section uuid
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_applicant = auth.uid()
    or exists (
      select 1
      from assignments a
      join post_permissions pp on pp.post_code = a.post_code
      where a.user_id = current_profile_id()
        and a.ends_on is null
        and pp.permission = 'application.view'
        and (p_current_post = a.post_code or a.post_code = any(p_post_codes_seen))
        and scope_covers(a.faculty_id, a.department_id, a.batch_id, a.section_id,
                         p_faculty, p_department, p_batch, p_section)
        and (
          not p_confidential
          or p_current_post = a.post_code
          or exists (
            select 1
            from assignments b
            join post_permissions bp on bp.post_code = b.post_code
            where b.user_id = current_profile_id()
              and b.ends_on is null
              and bp.permission = 'confidential.breakglass'
              and scope_covers(b.faculty_id, b.department_id, b.batch_id, b.section_id,
                               p_faculty, p_department, p_batch, p_section)
          )
        )
    );
$$;

-- Mirrors can_read_application for the (application_id, confidential, …) shape.
create or replace function can_read_application_id(p_application_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select can_read_application(
    a.applicant_id, a.confidential, a.current_post, a.post_codes_seen,
    a.faculty_id, a.department_id, a.batch_id, a.section_id
  )
  from applications a
  where a.id = p_application_id and a.deleted_at is null;
$$;

create or replace function can_read_notice(
  p_created_by uuid, p_status notice_status, p_publish_at timestamptz,
  p_scope_type post_scope, p_faculty uuid, p_department uuid, p_batch uuid, p_section uuid,
  p_audience notice_audience
) returns boolean
language sql stable security definer set search_path = public as $$
  select
    p_created_by = auth.uid()
    or (
      p_status in ('published', 'expired')
      and (p_publish_at is null or p_publish_at <= now())
      and (p_audience = 'everyone'
           or (p_audience = 'students' and exists (select 1 from profiles p where p.id = auth.uid() and p.kind = 'student'))
           or (p_audience = 'staff' and exists (select 1 from profiles p where p.id = auth.uid() and p.kind <> 'student')))
      and exists (
        select 1 from profiles p
        where p.id = auth.uid()
          and case p_scope_type
            when 'university' then true
            when 'faculty' then p.faculty_id = p_faculty
            when 'department' then p.department_id = p_department
            when 'batch' then p.batch_id = p_batch
            when 'section' then p.section_id = p_section
          end
      )
    )
    -- officers who may publish in that exact scope also see its drafts
    or exists (
      select 1
      from assignments a
      join post_permissions pp on pp.post_code = a.post_code
      where a.user_id = current_profile_id()
        and a.ends_on is null
        and pp.permission = 'notice.create'
        and (
          (p_scope_type = 'university' and exists (
             select 1 from post_permissions up
             where up.post_code = a.post_code and up.permission = 'notice.university'))
          or (p_scope_type <> 'university' and scope_covers(
             a.faculty_id, a.department_id, a.batch_id, a.section_id,
             p_faculty, p_department, p_batch, p_section))
        )
    );
$$;

-- ------------------------------------------------------------------- enable RLS

alter table profiles enable row level security;
alter table faculties enable row level security;
alter table departments enable row level security;
alter table batches enable row level security;
alter table sections enable row level security;
alter table posts enable row level security;
alter table post_permissions enable row level security;
alter table permissions enable row level security;
alter table assignments enable row level security;
alter table application_types enable row level security;
alter table workflow_versions enable row level security;
alter table applications enable row level security;
alter table application_actions enable row level security;
alter table status_events enable row level security;
alter table documents enable row level security;
alter table notices enable row level security;
alter table notice_reads enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table retention_jobs enable row level security;
alter table legal_holds enable row level security;
alter table deletion_audits enable row level security;
alter table settings enable row level security;

-- ------------------------------------------------------------------- policies

-- Reference data everyone signed in may read (no personal data in it).
create policy org_read on faculties for select to authenticated using (auth.uid() is not null);
create policy dept_read on departments for select to authenticated using (auth.uid() is not null);
create policy batch_read on batches for select to authenticated using (auth.uid() is not null);
create policy section_read on sections for select to authenticated using (auth.uid() is not null);
create policy post_read on posts for select to authenticated using (auth.uid() is not null);
create policy post_perm_read on post_permissions for select to authenticated using (auth.uid() is not null);
create policy permission_read on permissions for select to authenticated using (auth.uid() is not null);
create policy settings_read on settings for select to authenticated using (true);
create policy type_read on application_types for select to authenticated
  using (active or has_permission('workflow.configure'));
create policy workflow_read on workflow_versions for select to authenticated
  using (has_permission('application.view') or has_permission('workflow.configure'));

-- People: yourself, your scope, or if you manage accounts.
create policy profile_read on profiles for select to authenticated using (
  id = auth.uid()
  or has_permission('user.manage')
  or (
    has_permission('application.view')
    and exists (
      select 1 from assignments a
      where a.user_id = auth.uid() and a.ends_on is null
        and scope_covers(a.faculty_id, a.department_id, a.batch_id, a.section_id,
                         profiles.faculty_id, profiles.department_id, profiles.batch_id, profiles.section_id)
    )
  )
);

create policy assignment_read on assignments for select to authenticated using (
  user_id = auth.uid()
  or has_permission('user.manage')
  or exists (
    select 1 from assignments mine
    where mine.user_id = auth.uid() and mine.ends_on is null
      and scope_covers(mine.faculty_id, mine.department_id, mine.batch_id, mine.section_id,
                       assignments.faculty_id, assignments.department_id,
                       assignments.batch_id, assignments.section_id)
  )
);

-- Applications: applicant, officers whose posts the record passed through.
create policy application_read on applications for select to authenticated using (
  deleted_at is null
  and can_read_application(applicant_id, confidential, current_post, post_codes_seen,
                           faculty_id, department_id, batch_id, section_id)
);

create policy action_read on application_actions for select to authenticated using (
  can_read_application_id(application_id)
);

create policy status_event_read on status_events for select to authenticated using (
  visible and can_read_application_id(application_id)
);

create policy document_read on documents for select to authenticated using (
  (application_id is not null and can_read_application_id(application_id) and has_permission('document.view'))
  or (application_id is not null and exists (
        select 1 from applications a where a.id = documents.application_id and a.applicant_id = auth.uid()))
  or exists (
    select 1 from notices n
    where n.id = documents.notice_id
      and can_read_notice(n.created_by, n.status, n.publish_at, n.scope_type,
                          n.faculty_id, n.department_id, n.batch_id, n.section_id, n.audience))
);

create policy notice_read on notices for select to authenticated using (
  can_read_notice(created_by, status, publish_at, scope_type, faculty_id, department_id, batch_id, section_id, audience)
);

create policy notice_reads_own on notice_reads for select to authenticated using (user_id = auth.uid());
create policy notice_reads_insert on notice_reads for insert to authenticated with check (user_id = auth.uid());

create policy notification_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notification_mark_read on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_read on audit_log for select to authenticated using (has_permission('audit.view'));
create policy retention_read on retention_jobs for select to authenticated using (has_permission('retention.manage'));
create policy holds_read on legal_holds for select to authenticated using (has_permission('retention.manage'));
create policy deletion_read on deletion_audits for select to authenticated
  using (has_permission('retention.manage') or has_permission('audit.view'));

-- The profiles row for a new auth user is created by a trigger on auth.users,
-- never by the browser. Writes to every other table go through RPCs (definer).
revoke all on all tables in schema public from anon;
grant select on faculties, departments, batches, sections, posts, post_permissions,
  permissions, application_types, workflow_versions, settings, profiles, assignments,
  applications, application_actions, status_events, documents, notices, notice_reads,
  notifications, audit_log, retention_jobs, legal_holds, deletion_audits
  to authenticated;
revoke insert, update, delete on all tables in schema public from authenticated;
grant update (read_at) on notifications to authenticated;
grant insert on notice_reads to authenticated;

-- ------------------------------------------------------------------- storage

-- Private bucket for application and notice attachments.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-documents', 'private-documents', false, 3145728,
        array['application/pdf','image/png','image/jpeg','image/webp','text/plain'])
on conflict (id) do nothing;

-- Reads are allowed only when the matching document row is readable by the
-- caller; downloads should always come from a short-lived signed URL.
create policy document_object_read on storage.objects for select to authenticated
  using (
    bucket_id = 'private-documents'
    and exists (select 1 from documents d where d.storage_path = storage.objects.name)
  );

create policy document_object_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'private-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
