import type { Scope, WorkflowStage, WorkflowVersion } from '../domain/types';
import type { Grant } from './authz';
import { holdsPostInScope, scopeCovers } from './authz';

export interface RoutingHooks {
  /** true when at least one live assignment holds this post in the scope */
  postHasHolder: (postCode: string, scope: Scope) => boolean;
}

export interface RoutingResult {
  /** index of the stage that now owns the application; stages.length = after last stage */
  stageIndex: number;
  skipped: WorkflowStage[];
}

/**
 * A stage is skipped when:
 *  - the applicant currently holds that post in the application scope
 *    (self-approval must never happen, spec §6/§22.5), or
 *  - the stage is configured optional and no current holder exists, or
 *  - the configured post no longer exists / is inactive.
 */
export function stageMustSkip(
  stage: WorkflowStage,
  applicantGrants: Grant[],
  org: Scope,
  hooks: RoutingHooks,
): boolean {
  if (holdsPostInScope(applicantGrants, stage.post_code, org)) return true;
  if (stage.optional && !hooks.postHasHolder(stage.post_code, org)) return true;
  return false;
}

export function routeFrom(
  workflow: WorkflowVersion,
  fromIndex: number,
  applicantGrants: Grant[],
  org: Scope,
  hooks: RoutingHooks,
): RoutingResult {
  const skipped: WorkflowStage[] = [];
  for (let i = Math.max(0, fromIndex); i < workflow.stages.length; i++) {
    const stage = workflow.stages[i];
    if (stageMustSkip(stage, applicantGrants, org, hooks)) {
      skipped.push(stage);
      continue;
    }
    return { stageIndex: i, skipped };
  }
  return { stageIndex: workflow.stages.length, skipped };
}

export function isVcStage(stage?: WorkflowStage | null): boolean {
  return Boolean(stage && stage.post_code === 'VC');
}

export function isLastStage(workflow: WorkflowVersion, index: number): boolean {
  return index >= workflow.stages.length - 1;
}

/** Posts allowed to act at a given stage, resolved from the workflow version. */
export function stagePost(workflow: WorkflowVersion, index: number): string | null {
  if (index < 0 || index >= workflow.stages.length) return null;
  return workflow.stages[index].post_code;
}

export function applicantInScopeOfGrant(grant: Grant, org: Scope): boolean {
  return scopeCovers(grant.post, grant.scope, org);
}
