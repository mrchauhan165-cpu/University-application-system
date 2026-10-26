export const SCOPE_LABEL_FALLBACK = '—';

export const NOTICE_AUDIENCE: Record<string, string> = {
  everyone: 'Everyone',
  students: 'Students',
  staff: 'Staff & faculty',
};

export const SCOPE_TYPES = [
  { value: 'university', label: 'University-wide' },
  { value: 'faculty', label: 'Faculty' },
  { value: 'department', label: 'Department' },
  { value: 'batch', label: 'Batch' },
  { value: 'section', label: 'Section' },
] as const;

export const PERMISSION_LABELS: Record<string, { label: string; hint: string }> = {
  'application.submit': { label: 'Submit applications', hint: 'May submit application types that allow this group.' },
  'application.view': { label: 'View applications', hint: 'May read applications routed through this post within its scope.' },
  'application.act': { label: 'Approve / reject / return', hint: 'May take decisions on applications at this post.' },
  'document.view': { label: 'View documents', hint: 'May open private attachments of visible applications.' },
  'statistics.view': { label: 'View statistics', hint: 'May read aggregate statistics for this post’s scope.' },
  'notice.create': { label: 'Publish notices', hint: 'May publish notices within this post’s scope.' },
  'notice.university': { label: 'University-wide notices', hint: 'May publish notices for the whole university.' },
  'user.manage': { label: 'Manage users & structure', hint: 'May create accounts, reorganise faculties, batches and assignments.' },
  'workflow.configure': { label: 'Configure workflows', hint: 'May define application types and approval routes.' },
  'retention.manage': { label: 'Manage retention', hint: 'May propose, approve and run retention/deletion jobs.' },
  'audit.view': { label: 'View audit log', hint: 'May read the security and action audit trail.' },
  'system.admin': { label: 'System administration', hint: 'System settings. This never grants access to application contents.' },
  'confidential.breakglass': { label: 'Confidential access (break-glass)', hint: 'Separately authorised, audited access to confidential applications.' },
};
