import type { ReactNode } from 'react';
import { Icon } from './Icons';
import type { RouteStep } from '../lib/selectors';
import type { AppStatus, Application } from '../../domain/types';
import { STATUS_LABEL } from '../../domain/types';
import { postName } from '../lib/selectors';
import type { AppData } from '../../domain/types';

/* --------------------------------------------------------------- progress */

/**
 * Compact progress dots used inside lists: one dot per approval stage, so the
 * reader can see at a glance how far an application has travelled.
 */
export function ProgressDots({ steps, label }: { steps: RouteStep[]; label?: string }) {
  if (!steps.length) return null;
  return (
    <span className="progress-dots" role="img" aria-label={label ?? describeSteps(steps)} title={describeSteps(steps)}>
      {steps.map((step) => (
        <span key={step.key} className={`pdot ${step.state}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function describeSteps(steps: RouteStep[]): string {
  return steps.map((step) => `${step.label}: ${step.caption}`).join(', ');
}

/**
 * The full route: horizontal on wide screens, vertical on phones.
 * Each step states its post, its state and who decided it.
 */
export function StageStepper({ steps }: { steps: RouteStep[] }) {
  if (!steps.length) {
    return <p className="cell-sub">The approval route for this record is unavailable.</p>;
  }
  return (
    <ol className="stepper">
      {steps.map((step, index) => (
        <li key={step.key} className={`step ${step.state}`}>
          <span className="step-marker" aria-hidden="true">
            {step.state === 'done' ? (
              <Icon.Check size={15} />
            ) : step.state === 'attention' ? (
              <Icon.Alert size={15} />
            ) : step.state === 'current' ? (
              <span className="step-pulse" />
            ) : (
              <span className="step-index">{index + 1}</span>
            )}
          </span>
          <div className="step-body">
            <div className="step-label">{step.label}</div>
            <div className="step-post">{step.post}</div>
            <div className="step-caption">{step.caption}</div>
            {step.actor ? <div className="step-actor">{step.actor}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ status hero */

interface StatusView {
  tone: 'info' | 'success' | 'warn' | 'danger' | 'neutral';
  icon: ReactNode;
  headline: string;
  body: string;
  next: string;
}

const STATUS_VIEW: Record<string, (app: Application, data: AppData) => StatusView> = {
  draft: () => ({
    tone: 'neutral',
    icon: <Icon.File size={22} />,
    headline: 'Draft — not submitted',
    body: 'This application exists only for the applicant. No officer can see it yet.',
    next: 'Submit it when the details are complete. A reference number is issued at submission.',
  }),
  submitted: (app, data) => ({
    tone: 'info',
    icon: <Icon.Clock size={22} />,
    headline: 'Submitted — awaiting first review',
    body: app.current_post
      ? `It has reached ${postName(data, app.current_post)} and is waiting for a decision.`
      : 'It has been submitted and is waiting for a decision.',
    next: 'You will be notified at every stage. No action is needed from you right now.',
  }),
  under_review: (app, data) => ({
    tone: 'info',
    icon: <Icon.Clock size={22} />,
    headline: 'Under review',
    body: app.current_post
      ? `Currently with ${postName(data, app.current_post)} for review.`
      : 'Currently being reviewed by an authorised officer.',
    next: 'You will be notified when a decision is recorded, or if a correction is needed.',
  }),
  resubmitted: (app, data) => ({
    tone: 'info',
    icon: <Icon.Undo size={22} />,
    headline: 'Corrected and resubmitted',
    body: app.current_post
      ? `Your corrections are with ${postName(data, app.current_post)}. The earlier version is preserved in history.`
      : 'Your corrections have been resubmitted and are waiting for review.',
    next: 'Earlier decisions stay on record; this is a new review of the corrected application.',
  }),
  returned: (app, data) => ({
    tone: 'warn',
    icon: <Icon.Alert size={22} />,
    headline: 'Returned for correction — action needed',
    body: app.current_post
      ? `${postName(data, app.current_post)} asked for changes. The application is waiting for you.`
      : 'An officer asked for changes. The application is waiting for you.',
    next: 'Read the remarks from the officer, correct the details and resubmit.',
  }),
  further_pending: (app, data) => ({
    tone: 'warn',
    icon: <Icon.Shield size={22} />,
    headline: 'Approved by the VC — further approval pending',
    body: `The Vice-Chancellor approved and forwarded this application. It is now with ${postName(
      data,
      app.current_post,
    )} for final consideration.`,
    next: 'This is not a final approval. Only the configured higher authority can complete it.',
  }),
  completed: (app) => ({
    tone: 'success',
    icon: <Icon.CheckCircle size={22} />,
    headline: app.vc_approved ? 'Completed by the final authority' : 'Approved and completed',
    body: app.vc_approved
      ? 'The Vice-Chancellor approved and the configured higher authority completed the process.'
      : 'The final configured authority approved this application. No further action is needed.',
    next: 'Keep the reference number for your records. The decision trail is permanent.',
  }),
  rejected: (app) => ({
    tone: 'danger',
    icon: <Icon.XCircle size={22} />,
    headline: 'Rejected',
    body: `A decision to reject was recorded${app.decided_at ? ` on ${new Date(app.decided_at).toLocaleDateString()}` : ''}.`,
    next: 'The reason given to the applicant is shown in the decision trail below.',
  }),
  withdrawn: () => ({
    tone: 'neutral',
    icon: <Icon.Archive size={22} />,
    headline: 'Withdrawn by the applicant',
    body: 'This application was withdrawn before a decision was recorded.',
    next: 'A new application can be submitted if needed; this record stays for audit.',
  }),
};

export function StatusHero({
  app,
  data,
  steps,
  actions,
}: {
  app: Application;
  data: AppData;
  steps: RouteStep[];
  actions?: ReactNode;
}) {
  const view =
    STATUS_VIEW[app.status]?.(app, data) ?? {
      tone: 'neutral' as const,
      icon: <Icon.Info size={22} />,
      headline: (STATUS_LABEL[app.status as AppStatus] ?? app.status) as string,
      body: 'Status recorded by the system.',
      next: '',
    };
  const total = steps.length;
  const done = steps.filter((s) => s.state === 'done').length;

  return (
    <section className={`status-hero tone-${view.tone}`} aria-label="Application status">
      <div className="status-hero-main">
        <span className="status-hero-icon" aria-hidden="true">{view.icon}</span>
        <div style={{ minWidth: 0 }}>
          <div className="status-hero-headline">{view.headline}</div>
          <p className="status-hero-body">{view.body}</p>
          {view.next ? (
            <p className="status-hero-next">
              <Icon.Chevron size={13} /> {view.next}
            </p>
          ) : null}
        </div>
      </div>
      <div className="status-hero-side">
        {total ? (
          <div className="status-hero-progress">
            <span className="status-hero-count">
              {done}/{total}
            </span>
            <span className="cell-sub">route steps completed</span>
            <ProgressDots steps={steps} />
          </div>
        ) : null}
        {actions ? <div className="status-hero-actions">{actions}</div> : null}
      </div>
    </section>
  );
}
