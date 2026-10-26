/**
 * Core domain types — shared by the demo/LocalBackend, the Supabase adapter,
 * the authorisation engine and the UI. The SQL migrations mirror these shapes.
 */

export type UserKind = 'student' | 'teacher' | 'staff';

export type ScopeType = 'university' | 'faculty' | 'department' | 'batch' | 'section';

/** Permission dimensions are deliberately separate (spec §2). */
export type Permission =
  /** may submit this kind of application (per-type eligibility is checked too) */
  | 'application.submit'
  /** may view applications routed through their post & scope */
  | 'application.view'
  /** may approve / reject / return / forward */
  | 'application.act'
  /** may view private documents of applications they can view */
  | 'document.view'
  /** may view statistics for their permitted scope */
  | 'statistics.view'
  /** may create/publish notices within their permitted scope */
  | 'notice.create'
  /** may publish university-wide notices */
  | 'notice.university'
  /** may create users and manage assignments */
  | 'user.manage'
  /** may configure application types and workflows */
  | 'workflow.configure'
  /** may run retention / deletion workflows */
  | 'retention.manage'
  /** may read audit logs */
  | 'audit.view'
  /** system administration (never implies reading confidential content) */
  | 'system.admin'
  /** separate, justified, audited break-glass access to confidential content */
  | 'confidential.breakglass';

export interface Post {
  code: string;
  name: string;
  scope_type: ScopeType;
  rank: number;
  permissions: Permission[];
  is_system: boolean;
  active: boolean;
  description?: string;
}

export interface Scope {
  faculty_id?: string | null;
  department_id?: string | null;
  batch_id?: string | null;
  section_id?: string | null;
}

export interface Assignment {
  id: string;
  user_id: string;
  post_code: string;
  scope: Scope;
  /** ISO timestamps */
  starts_at: string;
  ends_at: string | null;
  active: boolean;
  created_by: string | null;
  reason: string | null;
  created_at: string;
  ended_by?: string | null;
  ended_reason?: string | null;
}

export interface Profile {
  id: string;
  user_code: string;
  full_name: string;
  email: string;
  kind: UserKind;
  status: 'invited' | 'active' | 'suspended';
  phone?: string | null;
  designation?: string | null;
  /** students only */
  department_id?: string | null;
  batch_id?: string | null;
  section_id?: string | null;
  roll_no?: string | null;
  /** teachers/staff only */
  home_department_id?: string | null;
  joined_on?: string | null;
  last_login_at?: string | null;
}

export interface Faculty {
  id: string;
  name: string;
  code: string;
  active: boolean;
  archived: boolean;
}

export interface Department {
  id: string;
  faculty_id: string;
  name: string;
  code: string;
  active: boolean;
  archived: boolean;
}

export type BatchStatus =
  | 'upcoming'
  | 'active'
  | 'graduated'
  | 'archived'
  | 'retention_review'
  | 'deletion_approval'
  | 'deletion_scheduled'
  | 'deleted';

export interface Batch {
  id: string;
  department_id: string;
  label: string;
  start_year: number;
  end_year: number;
  status: BatchStatus;
  /** months after graduation before the optional initial cleanup stage */
  retention_months: number;
  /** additional months before final deletion review */
  final_months: number;
  graduated_on: string | null;
  archived_on: string | null;
  created_at: string;
}

export interface Section {
  id: string;
  batch_id: string;
  name: string;
  capacity?: number | null;
}

export interface OrgSnapshot {
  faculty_id?: string | null;
  department_id?: string | null;
  batch_id?: string | null;
  section_id?: string | null;
  faculty_name?: string | null;
  department_name?: string | null;
  batch_label?: string | null;
  section_name?: string | null;
}

export type ApplicantKind = 'student' | 'teacher' | 'staff';

export interface FormField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
  help?: string;
  max_length?: number;
}

export interface DocRequirement {
  key: string;
  label: string;
  required: boolean;
  accept: string[];
  max_mb: number;
}

export interface ApplicationType {
  id: string;
  code: string;
  name: string;
  description: string;
  applicant_kinds: ApplicantKind[];
  confidential: boolean;
  allow_draft: boolean;
  allow_withdraw: boolean;
  fields: FormField[];
  documents: DocRequirement[];
  retention_category: string;
  /** posts that may view even if the application never passed through them */
  extra_viewer_posts: string[];
  /** used when every configured stage would be self-approval */
  fallback_approver_post: string | null;
  active: boolean;
  version: number;
  created_at: string;
}

export interface WorkflowStage {
  key: string;
  post_code: string;
  label: string;
  optional: boolean;
}

export interface BeyondFinalStage {
  post_code: string;
  label: string;
  actions: ('finalise' | 'reject' | 'return')[];
}

export interface WorkflowVersion {
  id: string;
  application_type_id: string;
  version: number;
  stages: WorkflowStage[];
  beyond_final: BeyondFinalStage | null;
  status: 'active' | 'retired';
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type AppStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'returned'
  | 'resubmitted'
  | 'further_pending'
  | 'approved'
  | 'completed'
  | 'rejected'
  | 'withdrawn';

export interface Application {
  id: string;
  reference: string;
  application_type_id: string;
  workflow_version_id: string;
  applicant_id: string;
  applicant_name: string;
  applicant_code: string;
  applicant_kind: ApplicantKind;
  org: OrgSnapshot;
  data: Record<string, unknown>;
  status: AppStatus;
  /** index into workflow.stages, -1 when finished */
  stage_index: number;
  current_post: string | null;
  beyond_active: boolean;
  beyond_done: boolean;
  /** every post that has held the application at some point (post history scope) */
  post_codes_seen: string[];
  /** applicant-facing tick for VC-stage approval */
  vc_approved: boolean;
  confidential: boolean;
  retention_category: string;
  created_at: string;
  submitted_at: string | null;
  updated_at: string;
  decided_at: string | null;
  withdrawn_reason?: string | null;
  deleted_at?: string | null;
  /** org units captured for retention (batch scoping) */
  batch_id: string | null;
}

export type ActionType =
  | 'submit'
  | 'resubmit'
  | 'approve'
  | 'reject'
  | 'return'
  | 'clarify'
  | 'forward'
  | 'finalise'
  | 'approve_forward'
  | 'remark'
  | 'withdraw'
  | 'system_skip'
  | 'reassign'
  | 'handover';

export interface ActionRecord {
  id: string;
  application_id: string;
  actor_id: string;
  actor_name: string;
  actor_code: string;
  /** post held at the time — history belongs to this post, not the person */
  post_code: string | null;
  post_name: string | null;
  assignment_id: string | null;
  scope_label: string | null;
  action: ActionType;
  from_status: AppStatus | null;
  to_status: AppStatus;
  remarks_internal: string | null;
  remarks_applicant: string | null;
  created_at: string;
}

export interface StatusEvent {
  id: string;
  application_id: string;
  status: AppStatus;
  label: string;
  note: string | null;
  visible: boolean;
  created_at: string;
}

export interface DocumentMeta {
  id: string;
  application_id: string | null;
  notice_id: string | null;
  doc_key: string;
  file_name: string;
  mime: string;
  size: number;
  storage_path: string | null;
  /** demo mode only: small data URL kept in browser storage */
  inline_data?: string | null;
  uploaded_by: string;
  uploaded_at: string;
  replaces_id?: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  /** hash route, permission re-checked when opened */
  link: string | null;
  category: 'application' | 'notice' | 'assignment' | 'retention' | 'system';
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
}

export type NoticeStatus = 'draft' | 'scheduled' | 'published' | 'expired' | 'archived';

export interface Notice {
  id: string;
  title: string;
  body: string;
  status: NoticeStatus;
  publish_at: string | null;
  expires_at: string | null;
  created_by: string;
  creator_name: string;
  creator_post: string | null;
  creator_code: string;
  scope: Scope;
  scope_type: ScopeType;
  scope_label: string;
  audience: 'students' | 'staff' | 'everyone';
  attachments: DocumentMeta[];
  created_at: string;
  updated_at: string;
  version: number;
}

export interface NoticeRead {
  notice_id: string;
  user_id: string;
  read_at: string;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface RetentionJob {
  id: string;
  batch_id: string;
  stage: 'initial_cleanup' | 'final_deletion';
  status: 'proposed' | 'awaiting_approval' | 'approved' | 'executed' | 'declined' | 'paused';
  dry_run: {
    applications: number;
    documents: number;
    notices: number;
    protected: number;
    bytes: number;
    generated_at: string;
  } | null;
  requested_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  executed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface LegalHold {
  id: string;
  batch_id: string;
  reason: string;
  active: boolean;
  created_by: string;
  created_at: string;
  released_at: string | null;
}

export interface DeletionAudit {
  id: string;
  batch_id: string;
  batch_label: string;
  stage: 'initial_cleanup' | 'final_deletion';
  approved_by_name: string;
  approved_by_id: string;
  counts: Record<string, number>;
  outcome: 'executed' | 'declined' | 'blocked';
  notes: string | null;
  created_at: string;
}

export interface Settings {
  university_name: string;
  university_short: string;
  support_email: string;
  timezone: string;
  seed_data: boolean;
  retention_months: number;
  final_retention_months: number;
  mfa_required_for_privileged: boolean;
  allow_self_registration: boolean;
}

/** Full snapshot consumed by the UI (already permission filtered). */
export interface AppData {
  profiles: Profile[];
  faculties: Faculty[];
  departments: Department[];
  batches: Batch[];
  sections: Section[];
  posts: Post[];
  assignments: Assignment[];
  applicationTypes: ApplicationType[];
  workflows: WorkflowVersion[];
  applications: Application[];
  actions: ActionRecord[];
  statusEvents: StatusEvent[];
  documents: DocumentMeta[];
  notifications: Notification[];
  notices: Notice[];
  noticeReads: NoticeRead[];
  audit: AuditEntry[];
  retentionJobs: RetentionJob[];
  legalHolds: LegalHold[];
  deletionAudits: DeletionAudit[];
  settings: Settings;
}

export interface Grant {
  assignment_id: string;
  post: Post;
  scope: Scope;
  permissions: Permission[];
  starts_at: string;
  ends_at: string | null;
}

export interface SessionUser {
  profile: Profile;
  assignments: Assignment[];
  grants: Grant[];
  permissions: Permission[];
  postCodes: string[];
  /** system administration — never implies access to confidential content */
  isAdmin: boolean;
  /** posts currently held per assignment, for messaging */
  postNames: string[];
}

export const STATUS_LABEL: Record<AppStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  returned: 'Returned for correction',
  resubmitted: 'Resubmitted',
  further_pending: 'VC approved — further approval pending',
  approved: 'Approved',
  completed: 'Completed',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const FINAL_STATUSES: AppStatus[] = ['approved', 'completed', 'rejected', 'withdrawn'];
export const OPEN_STATUSES: AppStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'returned',
  'resubmitted',
  'further_pending',
];
