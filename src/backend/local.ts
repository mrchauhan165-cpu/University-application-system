import type {
  AppData,
  ApplicationType,
  Assignment,
  Batch,
  BatchStatus,
  DocumentMeta,
  Faculty,
  LegalHold,
  Permission,
  Post,
  Profile,
  RetentionJob,
  Scope,
  SessionUser,
  Settings,
  UserKind,
  WorkflowVersion,
} from '../domain/types';
import { ApiError, fail } from './errors';
import { buildSession } from './session';
import { makeContext, type OpContext } from './ops/context';
import {
  actOnApplication,
  attachDocument,
  createApplication,
  deleteDraft,
  removeDocument,
  submitApplication,
  updateDraft,
  withdrawApplication,
  type ActInput,
  type UploadMeta,
} from './ops/applications';
import {
  archiveNotice,
  deleteNotice,
  markAllNoticesRead,
  markNoticeRead,
  publishNotice,
  saveNotice,
  sweepNotices,
  type NoticeInput,
} from './ops/notices';
import {
  archiveDepartment,
  archiveFaculty,
  endAssignment,
  migrateApplicationsOfType,
  migrateApplicationsToWorkflow,
  noticeAttachmentMeta,
  removeNoticeAttachment,
  saveApplicationType,
  saveAssignment,
  saveBatch,
  saveDepartment,
  saveFaculty,
  savePost,
  saveSection,
  saveSettings,
  saveUser,
  saveWorkflow,
  setBatchStatus,
  setUserStatus,
  type ApplicationTypeInput,
  type BatchInput,
  type UserInput,
  type WorkflowInput,
} from './ops/admin';
import {
  addLegalHold,
  approveRetentionJob,
  createRetentionJob,
  declineRetentionJob,
  executeRetentionJob,
  releaseLegalHold,
} from './ops/retention';
import { documentsForApplication, viewData } from './select';
import { createSeedData, DEMO_PASSWORD } from './seed';
import { hashPassword, passwordStrength, randomToken, verifyPassword } from './crypto';
import { LocalPersistence, SESSION_KEY, type AuthRecord, type PersistedState, type Persistence } from './store';

const SESSION_HOURS = 12;

export interface SignInResult {
  user: SessionUser;
}

export interface BackendApi {
  readonly mode: 'demo' | 'supabase';
  ready(): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSession(): SessionUser | null;
  getView(): AppData;
  getSettings(): Settings;
  /** only used by the sign-in screen and admin tooling */
  demoAccounts(): { email: string; role: string; password: string }[];
  signIn(email: string, password: string): Promise<SignInResult>;
  signOut(): void;
  changePassword(current: string, next: string): Promise<void>;
  requestPasswordReset(email: string): Promise<{ token: string; expires_at: string }>;
  resetPassword(token: string, next: string): Promise<void>;
  createActivation(userId: string): Promise<{ token: string; expires_at: string }>;
  activateAccount(token: string, next: string): Promise<void>;
  refresh(): void;
}

type Listener = () => void;

export class LocalBackend {
  readonly mode = 'demo' as const;
  private persistence: Persistence;
  private data: AppData;
  private auth: AuthRecord[];
  private sessionUserId: string | null = null;
  private sessionExpires = 0;
  private listeners = new Set<Listener>();
  private readyPromise: Promise<void> | null = null;
  /** bumped on every committed change so React can re-read the snapshot */
  version = 0;

  constructor(persistence?: Persistence) {
    this.persistence = persistence ?? new LocalPersistence();
    const loaded = this.persistence.load();
    if (loaded) {
      this.data = loaded.data;
      this.auth = loaded.auth;
    } else {
      this.data = createSeedData();
      this.auth = this.seedAuth(this.data);
      this.persist();
    }
    this.restoreSession();
  }

  /* ------------------------------------------------------------- plumbing */

  private seedAuth(data: AppData): AuthRecord[] {
    return data.profiles.map((p) => {
      const salt = randomToken(12);
      const { hash } = hashPassword(DEMO_PASSWORD, salt);
      return {
        user_id: p.id,
        salt,
        hash,
        must_change_password: false,
        activation_token: null,
        activation_expires: null,
        reset_token: null,
        reset_expires: null,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      };
    });
  }

  private restoreSession(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const { userId, expires } = JSON.parse(raw) as { userId: string; expires: number };
      if (!expires || expires < Date.now()) {
        window.localStorage.removeItem(SESSION_KEY);
        return;
      }
      const profile = this.data.profiles.find((p) => p.id === userId);
      if (!profile || profile.status !== 'active') {
        window.localStorage.removeItem(SESSION_KEY);
        return;
      }
      this.sessionUserId = userId;
      this.sessionExpires = expires;
    } catch {
      /* ignore malformed session */
    }
  }

  private writeSession(userId: string): void {
    this.sessionUserId = userId;
    this.sessionExpires = Date.now() + SESSION_HOURS * 3600_000;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ userId, expires: this.sessionExpires }),
      );
    } catch {
      /* storage may be unavailable — the in-memory session still works */
    }
  }

  private clearSession(): void {
    this.sessionUserId = null;
    this.sessionExpires = 0;
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    this.persistence.save({ data: this.data, auth: this.auth });
  }

  private emit(): void {
    this.version += 1;
    for (const l of this.listeners) l();
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async ready(): Promise<void> {
    this.readyPromise ??= Promise.resolve();
    return this.readyPromise;
  }

  refresh(): void {
    this.emit();
  }

  getSettings(): Settings {
    return this.data.settings;
  }

  getSession(): SessionUser | null {
    if (!this.sessionUserId) return null;
    if (this.sessionExpires && this.sessionExpires < Date.now()) {
      this.clearSession();
      return null;
    }
    const profile = this.data.profiles.find((p) => p.id === this.sessionUserId);
    if (!profile || profile.status !== 'active') {
      this.clearSession();
      return null;
    }
    return buildSession(this.data, profile, new Date().toISOString());
  }

  /** Applies time-based transitions (scheduled notices) at most every 30s. */
  private lastSweep = 0;
  sweep(): void {
    const nowMs = Date.now();
    if (nowMs - this.lastSweep < 30_000) return;
    this.lastSweep = nowMs;
    if (sweepNotices(this.data, new Date(nowMs).toISOString())) {
      try {
        this.persist();
      } catch {
        /* a failed sweep must not break reading the dashboard */
      }
      this.emit();
    }
  }

  getView(): AppData {
    this.sweep();
    const session = this.getSession();
    if (!session) {
      return {
        ...this.data,
        profiles: [],
        assignments: [],
        applications: [],
        actions: [],
        statusEvents: [],
        documents: [],
        notifications: [],
        notices: [],
        noticeReads: [],
        audit: [],
        retentionJobs: [],
        legalHolds: [],
        deletionAudits: [],
        applicationTypes: this.data.applicationTypes.filter((t) => t.active),
        workflows: [],
      };
    }
    return viewData(this.data, session, new Date().toISOString());
  }

  demoAccounts(): { email: string; role: string; password: string }[] {
    const order = ['usr_sysadmin', 'usr_wfadmin', 'usr_vc', 'usr_chancellor', 'usr_registrar', 'usr_dean_eng', 'usr_hod_cse', 'usr_mentor_a', 'usr_mentor_b', 'usr_teacher', 'usr_student_a', 'usr_student_b', 'usr_auditor', 'usr_former_hod'];
    const rows = order
      .map((id) => this.data.profiles.find((p) => p.id === id))
      .filter((p): p is Profile => Boolean(p))
      .map((p) => ({
        email: p.email,
        role: `${p.full_name} · ${this.data.assignments
          .filter((a) => a.user_id === p.id && a.active)
          .map((a) => this.data.posts.find((post) => post.code === a.post_code)?.name ?? a.post_code)
          .join(', ') || (p.kind === 'student' ? 'Student' : 'Staff (no post)')}`,
        password: DEMO_PASSWORD,
      }));
    return rows;
  }

  private requireSession(): SessionUser {
    const session = this.getSession();
    if (!session) fail('unauthenticated', 'Please sign in to continue.');
    return session;
  }

  /**
   * Runs a mutation against a copy of the state. The copy is committed only when
   * the operation succeeds, so a failed validation never leaves partial writes.
   */
  private mutate<T>(fn: (ctx: OpContext) => T): T {
    const session = this.requireSession();
    const draft = cloneData(this.data);
    const now = new Date().toISOString();
    const draftSession = buildSession(draft, draft.profiles.find((p) => p.id === session.profile.id)!, now);
    const ctx = makeContext(draft, draftSession, now);
    const result = fn(ctx);
    const previous = this.data;
    this.data = draft;
    try {
      this.persist();
    } catch (e) {
      // Roll back to the previous consistent state if storage is unavailable.
      this.data = previous;
      throw e;
    }
    this.emit();
    return result;
  }

  /* ----------------------------------------------------------------- auth */

  async signIn(email: string, password: string): Promise<SignInResult> {
    const normalised = email.trim().toLowerCase();
    const profile = this.data.profiles.find((p) => p.email.toLowerCase() === normalised);
    if (!profile) fail('invalid_credentials', 'Email or password is incorrect.');
    const record = this.auth.find((a) => a.user_id === profile!.id);
    if (!record) fail('invalid_credentials', 'Email or password is incorrect.');
    const nowMs = Date.now();
    if (record!.locked_until && Date.parse(record!.locked_until) > nowMs) {
      fail('locked', 'Too many failed attempts. Try again in a minute.');
    }
    if (profile!.status === 'suspended') fail('suspended', 'This account is suspended. Contact the administrator.');
    if (profile!.status === 'invited') {
      fail('invited', 'This account has not been activated yet. Use the activation link from your administrator.');
    }
    if (!verifyPassword(password, record!.salt, record!.hash)) {
      record!.failed_attempts += 1;
      if (record!.failed_attempts >= 5) {
        record!.failed_attempts = 0;
        record!.locked_until = new Date(nowMs + 60_000).toISOString();
      }
      this.persist();
      fail('invalid_credentials', 'Email or password is incorrect.');
    }
    record!.failed_attempts = 0;
    record!.locked_until = null;
    record!.updated_at = new Date().toISOString();
    const p = this.data.profiles.find((x) => x.id === profile!.id)!;
    p.last_login_at = new Date().toISOString();
    this.persist();
    this.writeSession(p.id);
    const user = buildSession(this.data, p, new Date().toISOString());
    this.emit();
    return { user };
  }

  signOut(): void {
    this.clearSession();
    this.emit();
  }

  async changePassword(current: string, next: string): Promise<void> {
    const session = this.requireSession();
    const record = this.auth.find((a) => a.user_id === session.profile.id);
    if (!record) fail('not_found', 'Account record not found.');
    if (!verifyPassword(current, record!.salt, record!.hash)) {
      fail('invalid_credentials', 'Your current password is incorrect.');
    }
    const strength = passwordStrength(next);
    if (strength.problems.length) fail('weak_password', strength.problems.join(' '));
    const { salt, hash } = hashPassword(next);
    record!.salt = salt;
    record!.hash = hash;
    record!.must_change_password = false;
    record!.updated_at = new Date().toISOString();
    this.persist();
    this.emit();
  }

  async requestPasswordReset(email: string): Promise<{ token: string; expires_at: string }> {
    const normalised = email.trim().toLowerCase();
    const profile = this.data.profiles.find((p) => p.email.toLowerCase() === normalised);
    // Always answer the same way so the screen cannot be used to enumerate accounts.
    const token = randomToken(24);
    const expires = new Date(Date.now() + 60 * 60_000).toISOString();
    if (profile) {
      const record = this.auth.find((a) => a.user_id === profile.id);
      if (record) {
        record.reset_token = token;
        record.reset_expires = expires;
        record.updated_at = new Date().toISOString();
        this.persist();
      }
    }
    return { token, expires_at: expires };
  }

  async resetPassword(token: string, next: string): Promise<void> {
    const record = this.auth.find((a) => a.reset_token && a.reset_token === token);
    if (!record) fail('invalid_token', 'This reset link is invalid or has already been used.');
    if (!record!.reset_expires || Date.parse(record!.reset_expires) < Date.now()) {
      fail('expired_token', 'This reset link has expired. Request a new one.');
    }
    const strength = passwordStrength(next);
    if (strength.problems.length) fail('weak_password', strength.problems.join(' '));
    const { salt, hash } = hashPassword(next);
    record!.salt = salt;
    record!.hash = hash;
    record!.reset_token = null;
    record!.reset_expires = null;
    record!.must_change_password = false;
    record!.updated_at = new Date().toISOString();
    const profile = this.data.profiles.find((p) => p.id === record!.user_id);
    if (profile && profile.status === 'invited') profile.status = 'active';
    this.persist();
    this.emit();
  }

  private ensureAuthRecord(userId: string): AuthRecord {
    let record = this.auth.find((a) => a.user_id === userId);
    if (!record) {
      // Accounts created by an administrator start unusable until activated.
      const salt = randomToken(12);
      record = {
        user_id: userId,
        salt,
        hash: hashPassword(randomToken(24), salt).hash,
        must_change_password: true,
        activation_token: null,
        activation_expires: null,
        reset_token: null,
        reset_expires: null,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      };
      this.auth.push(record);
    }
    return record;
  }

  async createActivation(userId: string): Promise<{ token: string; expires_at: string }> {
    const session = this.requireSession();
    if (!session.permissions.includes('user.manage')) {
      fail('forbidden', 'You are not authorised to invite users.');
    }
    const record = this.ensureAuthRecord(userId);
    const token = randomToken(24);
    const expires = new Date(Date.now() + 72 * 3600_000).toISOString();
    record!.activation_token = token;
    record!.activation_expires = expires;
    record!.updated_at = new Date().toISOString();
    this.persist();
    return { token, expires_at: expires };
  }

  async activateAccount(token: string, next: string): Promise<void> {
    const record = this.auth.find((a) => a.activation_token && a.activation_token === token);
    if (!record) fail('invalid_token', 'This activation link is invalid or has already been used.');
    if (!record!.activation_expires || Date.parse(record!.activation_expires) < Date.now()) {
      fail('expired_token', 'This activation link has expired. Ask your administrator for a new one.');
    }
    const strength = passwordStrength(next);
    if (strength.problems.length) fail('weak_password', strength.problems.join(' '));
    const { salt, hash } = hashPassword(next);
    record!.salt = salt;
    record!.hash = hash;
    record!.activation_token = null;
    record!.activation_expires = null;
    record!.must_change_password = false;
    record!.updated_at = new Date().toISOString();
    const profile = this.data.profiles.find((p) => p.id === record!.user_id);
    if (profile) profile.status = 'active';
    this.persist();
    this.emit();
  }

  /* --------------------------------------------------------- applications */

  createDraft(typeId: string, values: Record<string, unknown>) {
    return this.mutate((ctx) => createApplication(ctx, typeId, values));
  }

  updateDraft(appId: string, values: Record<string, unknown>) {
    return this.mutate((ctx) => updateDraft(ctx, appId, values));
  }

  submit(appId: string) {
    return this.mutate((ctx) => submitApplication(ctx, appId));
  }

  act(appId: string, input: ActInput) {
    return this.mutate((ctx) => actOnApplication(ctx, appId, input));
  }

  withdraw(appId: string, reason: string) {
    return this.mutate((ctx) => withdrawApplication(ctx, appId, reason));
  }

  deleteDraft(appId: string) {
    return this.mutate((ctx) => deleteDraft(ctx, appId));
  }

  documentList(appId: string): DocumentMeta[] {
    const session = this.requireSession();
    return documentsForApplication(this.data, session, appId);
  }

  async uploadDocument(appId: string, docKey: string, file: File): Promise<DocumentMeta> {
    const meta = await readFile(file, 3 * 1024 * 1024);
    return this.mutate((ctx) => attachDocument(ctx, appId, docKey, meta));
  }

  removeDocument(docId: string) {
    return this.mutate((ctx) => removeDocument(ctx, docId));
  }

  /** Re-checks permission on every call; never cache the returned URL. */
  getDocumentDataUrl(docId: string): { fileName: string; mime: string; dataUrl: string } {
    const session = this.requireSession();
    const doc = this.data.documents.find((d) => d.id === docId);
    if (!doc) fail('not_found', 'Document not found.');
    if (doc!.application_id) {
      const allowed = documentsForApplication(this.data, session, doc!.application_id).some((d) => d.id === docId);
      if (!allowed) fail('forbidden', 'You are not authorised to view this document.');
    } else if (doc!.notice_id) {
      const view = this.getView();
      if (!view.notices.some((n) => n.id === doc!.notice_id)) {
        fail('forbidden', 'You are not authorised to view this attachment.');
      }
    } else {
      fail('forbidden', 'You are not authorised to view this document.');
    }
    if (!doc!.inline_data) fail('not_found', 'This demo attachment has no stored content.');
    return { fileName: doc!.file_name, mime: doc!.mime, dataUrl: doc!.inline_data };
  }

  /* --------------------------------------------------------------- notices */

  saveNotice(input: NoticeInput) {
    return this.mutate((ctx) => saveNotice(ctx, input));
  }

  publishNotice(noticeId: string) {
    return this.mutate((ctx) => publishNotice(ctx, noticeId));
  }

  archiveNotice(noticeId: string) {
    return this.mutate((ctx) => archiveNotice(ctx, noticeId));
  }

  deleteNotice(noticeId: string) {
    return this.mutate((ctx) => deleteNotice(ctx, noticeId));
  }

  markNoticeRead(noticeId: string) {
    return this.mutate((ctx) => markNoticeRead(ctx, noticeId));
  }

  markAllNoticesRead() {
    return this.mutate((ctx) => {
      const ids = ctx.data.notices
        .filter((n) => n.status === 'published')
        .map((n) => n.id);
      markAllNoticesRead(ctx, ids);
    });
  }

  async attachNoticeFile(noticeId: string, file: File): Promise<DocumentMeta> {
    const meta = await readFile(file, 2 * 1024 * 1024);
    return this.mutate((ctx) => noticeAttachmentMeta(ctx, noticeId, meta));
  }

  removeNoticeAttachment(noticeId: string, docId: string) {
    return this.mutate((ctx) => removeNoticeAttachment(ctx, noticeId, docId));
  }

  /* --------------------------------------------------------- notifications */

  markNotificationRead(id: string, read = true) {
    return this.mutate((ctx) => {
      const n = ctx.data.notifications.find((x) => x.id === id);
      if (!n) fail('not_found', 'Notification not found.');
      if (n!.user_id !== ctx.actor.profile.id) fail('forbidden', 'Not your notification.');
      n!.read_at = read ? ctx.now : null;
    });
  }

  markAllNotificationsRead() {
    return this.mutate((ctx) => {
      for (const n of ctx.data.notifications) {
        if (n.user_id === ctx.actor.profile.id && !n.read_at) n.read_at = ctx.now;
      }
    });
  }

  /* ------------------------------------------------------------- admin ops */

  saveFaculty(input: { id?: string; name: string; code: string }): Faculty {
    return this.mutate((ctx) => saveFaculty(ctx, input));
  }
  archiveFaculty(id: string) {
    return this.mutate((ctx) => archiveFaculty(ctx, id));
  }
  saveDepartment(input: { id?: string; faculty_id: string; name: string; code: string }) {
    return this.mutate((ctx) => saveDepartment(ctx, input));
  }
  archiveDepartment(id: string) {
    return this.mutate((ctx) => archiveDepartment(ctx, id));
  }
  saveBatch(input: BatchInput): Batch {
    return this.mutate((ctx) => saveBatch(ctx, input));
  }
  setBatchStatus(id: string, status: BatchStatus) {
    return this.mutate((ctx) => setBatchStatus(ctx, id, status));
  }
  saveSection(input: { id?: string; batch_id: string; name: string; capacity?: number | null }) {
    return this.mutate((ctx) => saveSection(ctx, input));
  }
  saveUser(input: UserInput): { profile: Profile } {
    const result = this.mutate((ctx) => saveUser(ctx, input));
    if (!input.id) {
      this.ensureAuthRecord(result.profile.id);
      this.persist();
    }
    return result;
  }
  setUserStatus(id: string, status: Profile['status']) {
    return this.mutate((ctx) => setUserStatus(ctx, id, status));
  }
  saveAssignment(input: { user_id: string; post_code: string; scope: Scope; starts_at?: string; reason?: string }): Assignment {
    return this.mutate((ctx) => saveAssignment(ctx, input));
  }
  endAssignment(id: string, reason: string) {
    return this.mutate((ctx) => endAssignment(ctx, id, reason));
  }
  savePost(post: Post): Post {
    return this.mutate((ctx) => savePost(ctx, post));
  }
  saveApplicationType(input: ApplicationTypeInput): ApplicationType {
    return this.mutate((ctx) => saveApplicationType(ctx, input));
  }
  saveWorkflow(input: WorkflowInput): WorkflowVersion {
    return this.mutate((ctx) => saveWorkflow(ctx, input));
  }
  migrateApplications(workflowId: string, applicationIds: string[]): number {
    return this.mutate((ctx) => migrateApplicationsToWorkflow(ctx, workflowId, applicationIds));
  }
  migrateApplicationsOfType(typeId: string, workflowId: string): number {
    return this.mutate((ctx) => migrateApplicationsOfType(ctx, typeId, workflowId));
  }
  inProgressCountForType(typeId: string): number {
    if (!this.getSession()) fail('unauthenticated', 'Please sign in to continue.');
    return this.data.applications.filter(
      (a) =>
        a.application_type_id === typeId &&
        ['submitted', 'under_review', 'resubmitted', 'further_pending', 'returned'].includes(a.status),
    ).length;
  }
  saveSettings(patch: Partial<Settings>) {
    return this.mutate((ctx) => saveSettings(ctx, patch));
  }
  createRetentionJob(batchId: string, stage: RetentionJob['stage']): RetentionJob {
    return this.mutate((ctx) => createRetentionJob(ctx, batchId, stage));
  }
  approveRetentionJob(jobId: string, notes: string) {
    return this.mutate((ctx) => approveRetentionJob(ctx, jobId, notes));
  }
  declineRetentionJob(jobId: string, notes: string) {
    return this.mutate((ctx) => declineRetentionJob(ctx, jobId, notes));
  }
  executeRetentionJob(jobId: string, confirmation: string) {
    return this.mutate((ctx) => executeRetentionJob(ctx, jobId, confirmation));
  }
  addLegalHold(batchId: string, reason: string): LegalHold {
    return this.mutate((ctx) => addLegalHold(ctx, batchId, reason));
  }
  releaseLegalHold(id: string) {
    return this.mutate((ctx) => releaseLegalHold(ctx, id));
  }

  /* -------------------------------------------------------------- dev tools */

  exportState(): string {
    const session = this.requireSession();
    if (!session.permissions.includes('system.admin')) {
      fail('forbidden', 'Only a system administrator can export the data set.');
    }
    return JSON.stringify({ data: this.data, auth: this.auth }, null, 2);
  }

  importState(json: string): void {
    const session = this.requireSession();
    if (!session.permissions.includes('system.admin')) {
      fail('forbidden', 'Only a system administrator can import a data set.');
    }
    let parsed: PersistedState;
    try {
      parsed = JSON.parse(json) as PersistedState;
    } catch {
      fail('validation', 'That file is not valid JSON.');
    }
    if (!parsed!.data?.profiles || !Array.isArray(parsed!.data.profiles)) {
      fail('validation', 'That file is not a university portal data export.');
    }
    this.data = parsed!.data;
    this.auth = parsed!.auth ?? [];
    this.persist();
    this.emit();
  }

  resetDemoData(): void {
    this.data = createSeedData();
    this.auth = this.seedAuth(this.data);
    this.clearSession();
    this.persist();
    this.emit();
  }

  /** Convenience for tests and for the "workflow" screen previews. */
  peek(): AppData {
    return this.data;
  }

  /** Audited export of statistics data (permission checked by the caller's view). */
  recordExport(what: string): void {
    if (!this.requireSession().permissions.includes('statistics.view')) {
      fail('forbidden', 'You are not authorised to export data.');
    }
    this.mutate((ctx) => {
      ctx.audit('statistics.export', 'report', null, { what });
    });
  }

  postByCode(code: string): Post | undefined {
    return this.data.posts.find((p) => p.code === code);
  }

  permissionList(): Permission[] {
    return [
      'application.submit',
      'application.view',
      'application.act',
      'document.view',
      'statistics.view',
      'notice.create',
      'notice.university',
      'user.manage',
      'workflow.configure',
      'retention.manage',
      'audit.view',
      'system.admin',
      'confidential.breakglass',
    ];
  }

  userKindLabel(kind: UserKind): string {
    return kind === 'student' ? 'Student' : kind === 'teacher' ? 'Teacher / faculty' : 'Staff';
  }
}

function cloneData(data: AppData): AppData {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(data);
    } catch {
      /* fall through */
    }
  }
  return JSON.parse(JSON.stringify(data)) as AppData;
}

async function readFile(file: File, maxBytes: number): Promise<UploadMeta> {
  if (file.size > maxBytes) {
    throw new ApiError('validation', `File must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
  }
  if (file.size === 0) throw new ApiError('validation', 'That file is empty.');
  const mime = file.type || guessMime(file.name);
  let dataUrl: string;
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    dataUrl = `data:${mime};base64,${base64FromBytes(new Uint8Array(buffer))}`;
  } else {
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new ApiError('validation', 'The file could not be read. Try again.'));
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.readAsDataURL(file);
    });
  }
  return { fileName: file.name, mime, size: file.size, dataUrl };
}

function base64FromBytes(bytes: Uint8Array): string {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b3 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += table[b1 >> 2];
    out += table[((b1 & 3) << 4) | ((b2 ?? 0) >> 4)];
    out += b2 === undefined ? '=' : table[((b2 & 15) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? '=' : table[b3 & 63];
  }
  return out;
}

function guessMime(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

export type { NoticeInput, UserInput, BatchInput, ActInput };
