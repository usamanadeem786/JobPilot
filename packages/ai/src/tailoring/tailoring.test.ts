import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv';
import { describe, expect, it, vi } from 'vitest';
import { LlmService } from '../llm.service';
import { MockLlmProvider } from '../providers/mock';
import { AiProviderNotConfiguredError } from '../types';
import { CvFabricationError, CvTailoringService } from './service';

const source: CvDocument = CvDocumentSchema.parse({
  personal: { fullName: 'Usama Nadeem', email: 'usama@example.com' },
  summary: 'Backend engineer focused on Python services.',
  skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
  experience: [
    {
      company: 'Acme Systems',
      title: 'Senior Backend Engineer',
      startDate: { raw: 'Mar 2022', year: 2022 },
      isCurrent: true,
      bullets: ['Cut p95 latency from 840ms to 120ms', 'Mentored 4 junior engineers'],
    },
  ],
  education: [{ institution: 'University of the Punjab', qualification: 'BSc', field: 'Computer Science' }],
});

const CHANGE_SUMMARY = {
  keywordsEmphasised: ['Python'],
  experienceEmphasised: ['Acme Systems'],
  skillsMatched: ['Python'],
  requirementsNotEvidenced: ['Kubernetes'],
  sectionsReordered: true,
};

function reply(document: CvDocument): string {
  return JSON.stringify({ document, changeSummary: CHANGE_SUMMARY });
}

const JOB = {
  jobTitle: 'Senior Python Engineer',
  companyName: 'Globex',
  jobDescription: 'Python, Django, Kubernetes.',
};

describe('CvTailoringService', () => {
  const now = () => new Date('2026-08-22T12:00:00Z');

  it('refuses when no provider is configured', async () => {
    // No deterministic fallback here on purpose: a keyword shuffle dressed up
    // as tailoring is worse than saying the feature is unavailable.
    const llm = new LlmService({
      name: 'none',
      defaultModel: 'x',
      isConfigured: () => false,
      complete: () => Promise.reject(new Error('unreachable')),
    });

    await expect(new CvTailoringService(llm).tailor({ cv: source, ...JOB })).rejects.toBeInstanceOf(
      AiProviderNotConfiguredError,
    );
  });

  it('returns a faithfully rewritten CV', async () => {
    const rewritten = CvDocumentSchema.parse({
      ...source,
      summary: 'Python engineer specialising in Django services.',
      experience: [
        {
          ...source.experience[0]!,
          bullets: ['Reduced p95 latency 840ms to 120ms', 'Mentored 4 engineers'],
        },
      ],
    });

    const service = new CvTailoringService(new LlmService(new MockLlmProvider([reply(rewritten)])), { now });
    const result = await service.tailor({ cv: source, ...JOB });

    expect(result.document.summary).toContain('Django');
    expect(result.changeSummary.requirementsNotEvidenced).toContain('Kubernetes');
    expect(result.promptVersion).toBe('1.0.0');
  });

  it('rejects a CV that gained an employer, even after a retry', async () => {
    const fabricated = CvDocumentSchema.parse({
      ...source,
      experience: [
        ...source.experience,
        { company: 'Google', title: 'Staff Engineer', isCurrent: false, bullets: [] },
      ],
    });

    const provider = new MockLlmProvider([reply(fabricated), reply(fabricated)]);
    const service = new CvTailoringService(new LlmService(provider), { now });

    await expect(service.tailor({ cv: source, ...JOB })).rejects.toBeInstanceOf(CvFabricationError);
  });

  it('shows the model exactly what it invented before retrying', async () => {
    const fabricated = CvDocumentSchema.parse({
      ...source,
      certifications: [{ name: 'Certified Kubernetes Administrator' }],
    });

    const provider = new MockLlmProvider([reply(fabricated), reply(source)]);
    const service = new CvTailoringService(new LlmService(provider), { now });

    const result = await service.tailor({ cv: source, ...JOB });

    expect(result.document.certifications).toEqual([]);
    // The retry must name the violation; repeating the same prompt tends to
    // reproduce the same invention.
    expect(provider.requests[1]?.user).toContain('NOT in the source CV');
    expect(provider.requests[1]?.user).toContain('Certified Kubernetes Administrator');
  });

  it('carries every finding on the error, not just the first', async () => {
    const fabricated = CvDocumentSchema.parse({
      ...source,
      experience: [{ company: 'Google', title: 'Engineer', isCurrent: false, bullets: [] }],
      certifications: [{ name: 'CKA' }],
    });

    const service = new CvTailoringService(
      new LlmService(new MockLlmProvider([reply(fabricated), reply(fabricated)])),
      { now, retryOnFabrication: false },
    );

    try {
      await service.tailor({ cv: source, ...JOB });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(CvFabricationError);
      expect((error as CvFabricationError).findings.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('rejects an inflated metric', async () => {
    // Same claim, better number — invisible on a read-through, and the most
    // tempting thing for a model asked to make a CV look stronger.
    const inflated = CvDocumentSchema.parse({
      ...source,
      experience: [{ ...source.experience[0]!, bullets: ['Mentored 40 junior engineers'] }],
    });

    const service = new CvTailoringService(
      new LlmService(new MockLlmProvider([reply(inflated), reply(inflated)])),
      { now },
    );

    await expect(service.tailor({ cv: source, ...JOB })).rejects.toBeInstanceOf(CvFabricationError);
  });

  it('logs the rejection so a pattern of failures is visible', async () => {
    const fabricated = CvDocumentSchema.parse({
      ...source,
      education: [{ institution: 'Stanford University', qualification: 'MSc', bullets: [] }],
    });

    const warn = vi.fn();
    const service = new CvTailoringService(
      new LlmService(new MockLlmProvider([reply(fabricated), reply(source)])),
      { now, logger: { warn } },
    );

    await service.tailor({ cv: source, ...JOB });
    expect(warn).toHaveBeenCalledWith('Tailored CV rejected for fabrication', expect.anything());
  });
});
