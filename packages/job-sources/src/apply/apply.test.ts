import { ApplyMethod, EmploymentType, ExperienceLevel, RemoteType } from '@jobpilot/shared';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../normalise';
import type { NormalisedJob } from '../types';
import {
  ApplicationGateway,
  AutomatedApplicationNotPermittedError,
  type ApplicationAdapter,
  type ApplicationPayload,
} from './adapter';

function job(overrides: Partial<NormalisedJob> = {}): NormalisedJob {
  return {
    sourceKey: 'greenhouse',
    externalJobId: '1',
    title: 'Backend Engineer',
    companyName: 'Acme',
    remoteType: RemoteType.UNKNOWN,
    employmentType: EmploymentType.UNKNOWN,
    experienceLevel: ExperienceLevel.UNKNOWN,
    description: 'Build things.',
    jobUrl: 'https://boards.example.com/acme/1',
    applicationUrl: 'https://boards.example.com/acme/1/apply',
    applyMethod: ApplyMethod.EXTERNAL_URL,
    postedAtKnown: false,
    contentHash: contentHash('Backend Engineer', 'Acme'),
    ...overrides,
  };
}

const payload: ApplicationPayload = {
  fullName: 'Usama Nadeem',
  email: 'usama@example.com',
  cvFile: { filename: 'cv.pdf', content: Buffer.from('%PDF-'), mimeType: 'application/pdf' },
};

/** A hypothetical partner integration, used only to exercise the gate. */
function permittedAdapter(submit = vi.fn()): ApplicationAdapter {
  return {
    sourceKey: 'permitted-partner',
    supportsAutomation: true,
    validate: () => [],
    submit: submit.mockResolvedValue({ submitted: true, detail: 'ok', externalApplicationId: 'x1' }),
  };
}

describe('ApplicationGateway.plan', () => {
  it('plans a manual application for an ordinary job', () => {
    const plan = new ApplicationGateway().plan(job());

    expect(plan.kind).toBe('manual');
    if (plan.kind === 'manual') {
      expect(plan.applicationUrl).toBe('https://boards.example.com/acme/1/apply');
      expect(plan.reason).toContain('does not permit automated applications');
    }
  });

  it('always produces a plan, because every job has an official page', () => {
    // There is no "cannot apply" outcome; the only question is whether the
    // software may fill the form in.
    for (const applyMethod of [ApplyMethod.EXTERNAL_URL, ApplyMethod.MANUAL_ONLY, ApplyMethod.PERMITTED_API]) {
      expect(new ApplicationGateway().plan(job({ applyMethod }))).toBeTruthy();
    }
  });

  it('offers the assisted workflow when the deployment disables automation', () => {
    const plan = new ApplicationGateway({
      deploymentAllowsAutomation: false,
      adapters: [permittedAdapter()],
    }).plan(job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }), 'Dear team,');

    expect(plan.kind).toBe('manual');
    if (plan.kind === 'manual') {
      expect(plan.preparedCoverLetter).toBe('Dear team,');
      expect(plan.instructions).toContain('ready to paste');
    }
  });

  it('plans an automated application only when both gates agree', () => {
    const plan = new ApplicationGateway({
      deploymentAllowsAutomation: true,
      adapters: [permittedAdapter()],
    }).plan(job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }));

    expect(plan.kind).toBe('automated');
  });

  it('refuses automation when the adapter claims it but the job does not', () => {
    // Guards against an adapter overstating its permissions.
    const plan = new ApplicationGateway({
      deploymentAllowsAutomation: true,
      adapters: [permittedAdapter()],
    }).plan(job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.EXTERNAL_URL }));

    expect(plan.kind).toBe('manual');
  });

  it('defaults to automation disabled when the setting is absent', () => {
    // A missing setting must never read as permission.
    const plan = new ApplicationGateway({ adapters: [permittedAdapter()] }).plan(
      job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }),
    );
    expect(plan.kind).toBe('manual');
  });
});

describe('ApplicationGateway.submit', () => {
  it('refuses to submit for a platform that does not permit it', async () => {
    await expect(new ApplicationGateway().submit(job(), payload)).rejects.toBeInstanceOf(
      AutomatedApplicationNotPermittedError,
    );
  });

  it('never calls an adapter it is not allowed to use', async () => {
    const submit = vi.fn();
    const gateway = new ApplicationGateway({
      deploymentAllowsAutomation: false,
      adapters: [permittedAdapter(submit)],
    });

    await expect(
      gateway.submit(job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }), payload),
    ).rejects.toBeInstanceOf(AutomatedApplicationNotPermittedError);

    expect(submit).not.toHaveBeenCalled();
  });

  it('re-checks permission rather than trusting that plan() was called', async () => {
    // A caller that skips planning must not be able to skip the gate with it.
    const submit = vi.fn();
    const gateway = new ApplicationGateway({
      deploymentAllowsAutomation: true,
      adapters: [permittedAdapter(submit)],
    });

    await expect(gateway.submit(job({ applyMethod: ApplyMethod.EXTERNAL_URL }), payload)).rejects.toThrow();
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits through a permitted adapter', async () => {
    const submit = vi.fn();
    const gateway = new ApplicationGateway({
      deploymentAllowsAutomation: true,
      adapters: [permittedAdapter(submit)],
    });

    const result = await gateway.submit(
      job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }),
      payload,
    );

    expect(result.submitted).toBe(true);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('reports validation problems instead of sending an incomplete application', async () => {
    const adapter: ApplicationAdapter = {
      sourceKey: 'permitted-partner',
      supportsAutomation: true,
      validate: () => [{ field: 'phone', message: 'required by this employer' }],
      submit: vi.fn(),
    };

    const result = await new ApplicationGateway({
      deploymentAllowsAutomation: true,
      adapters: [adapter],
    }).submit(job({ sourceKey: 'permitted-partner', applyMethod: ApplyMethod.PERMITTED_API }), payload);

    expect(result.submitted).toBe(false);
    expect(result.detail).toContain('phone');
    expect(adapter.submit).not.toHaveBeenCalled();
  });
});
