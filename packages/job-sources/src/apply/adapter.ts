import { ApplyMethod, decideAutomation, type AutomationDecision } from '@jobpilot/shared';
import type { NormalisedJob } from '../types';

/**
 * Application submission.
 *
 * No adapter shipped today implements `submit`, and that is the point: the
 * interface exists so a permitted integration can be added later without
 * reshaping the application, not so automation can be switched on.
 *
 * The gate is enforced here rather than in a controller, because a controller
 * is one refactor away from being bypassed. Anything that wants to submit an
 * application has to come through `ApplicationGateway`, and the gateway
 * refuses unless the platform and the deployment independently agree.
 */

export interface ApplicationPayload {
  readonly fullName: string;
  readonly email: string;
  readonly phone?: string;
  readonly cvFile: { readonly filename: string; readonly content: Buffer; readonly mimeType: string };
  readonly coverLetter?: string;
  readonly answers?: Readonly<Record<string, string>>;
}

export interface SubmissionResult {
  readonly submitted: boolean;
  readonly externalApplicationId?: string;
  readonly detail: string;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/**
 * Implemented only for platforms whose terms explicitly permit programmatic
 * applications. `supportsAutomation` is a claim the gateway cross-checks
 * against the job's own apply method before believing it.
 */
export interface ApplicationAdapter {
  readonly sourceKey: string;
  readonly supportsAutomation: boolean;

  /** Checks the payload against the platform's requirements before sending. */
  validate(job: NormalisedJob, payload: ApplicationPayload): ValidationIssue[];

  submit(job: NormalisedJob, payload: ApplicationPayload): Promise<SubmissionResult>;

  getStatus?(externalApplicationId: string): Promise<string>;
}

/** Everything needed to apply by hand, for the majority of jobs. */
export interface ManualApplicationPlan {
  readonly kind: 'manual';
  readonly applicationUrl: string;
  readonly instructions: string;
  /** Prepared for the user to paste; nothing is sent on their behalf. */
  readonly preparedCoverLetter: string | null;
  readonly reason: string;
}

export interface AutomatedApplicationPlan {
  readonly kind: 'automated';
  readonly adapter: ApplicationAdapter;
  readonly reason: string;
}

export type ApplicationPlan = ManualApplicationPlan | AutomatedApplicationPlan;

export class AutomatedApplicationNotPermittedError extends Error {
  constructor(readonly decision: AutomationDecision) {
    super(decision.reason);
    this.name = 'AutomatedApplicationNotPermittedError';
  }
}

export interface GatewayOptions {
  /** SystemSetting compliance.allowAutomatedApplications. Defaults to off. */
  readonly deploymentAllowsAutomation?: boolean;
  readonly adapters?: readonly ApplicationAdapter[];
}

export class ApplicationGateway {
  private readonly adapters: Map<string, ApplicationAdapter>;
  private readonly deploymentAllowsAutomation: boolean;

  constructor(options: GatewayOptions = {}) {
    this.adapters = new Map((options.adapters ?? []).map((adapter) => [adapter.sourceKey, adapter]));
    // Defaults to false. Automation has to be turned on deliberately; a
    // missing setting must never read as permission.
    this.deploymentAllowsAutomation = options.deploymentAllowsAutomation ?? false;
  }

  /**
   * Decides how this job can be applied to.
   *
   * Always returns a plan. There is no "cannot apply" outcome, because every
   * job has an official application page — the question is only whether the
   * software may fill it in.
   */
  plan(job: NormalisedJob, preparedCoverLetter: string | null = null): ApplicationPlan {
    const adapter = this.adapters.get(job.sourceKey);

    const decision = decideAutomation({
      applyMethod: job.applyMethod,
      sourceSupportsAutomation: adapter?.supportsAutomation ?? false,
      deploymentAllowsAutomation: this.deploymentAllowsAutomation,
    });

    if (decision.permitted && adapter) {
      return { kind: 'automated', adapter, reason: decision.reason };
    }

    return {
      kind: 'manual',
      applicationUrl: job.applicationUrl,
      instructions:
        decision.fallback === 'assisted'
          ? 'Your tailored CV and cover letter are ready to paste into the employer’s form.'
          : 'Opens the employer’s official application page in a new tab.',
      preparedCoverLetter,
      reason: decision.reason,
    };
  }

  /**
   * Submits an application, or refuses.
   *
   * The permission check is repeated here rather than trusting that `plan` was
   * called first, because a caller that skips planning must not be able to
   * skip the gate with it.
   */
  async submit(
    job: NormalisedJob,
    payload: ApplicationPayload,
  ): Promise<SubmissionResult> {
    const plan = this.plan(job);

    if (plan.kind === 'manual') {
      throw new AutomatedApplicationNotPermittedError({
        permitted: false,
        reason: plan.reason,
        fallback: 'open-official-page',
      });
    }

    const issues = plan.adapter.validate(job, payload);
    if (issues.length > 0) {
      return {
        submitted: false,
        detail: `The application is incomplete: ${issues.map((issue) => `${issue.field} — ${issue.message}`).join('; ')}`,
      };
    }

    return plan.adapter.submit(job, payload);
  }
}

/**
 * The apply method for a source with no permitted automation path.
 *
 * Every adapter shipped today returns this, which is why `ApplyMethod` exists
 * as data on the job rather than as a runtime check somewhere in the UI.
 */
export const DEFAULT_APPLY_METHOD = ApplyMethod.EXTERNAL_URL;
