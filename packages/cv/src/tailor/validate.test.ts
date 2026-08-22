import { describe, expect, it } from 'vitest';
import { CvDocumentSchema, type CvDocument } from '../schema';
import { extractNumbers, validateNoFabrication } from './validate';

/**
 * These tests encode the product's central safety promise: a tailored CV may
 * be rewritten and reordered, but it may not gain a single verifiable fact
 * that was not in the source.
 */
function cv(overrides: Partial<CvDocument> = {}): CvDocument {
  return CvDocumentSchema.parse({
    personal: { fullName: 'Usama Nadeem', email: 'usama@example.com' },
    summary: 'Backend engineer focused on Python services.',
    skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
    experience: [
      {
        company: 'Acme Systems',
        title: 'Senior Backend Engineer',
        startDate: { raw: 'Mar 2022', year: 2022, month: 3 },
        isCurrent: true,
        bullets: ['Cut p95 latency from 840ms to 120ms', 'Mentored 4 junior engineers'],
      },
    ],
    education: [{ institution: 'University of the Punjab', qualification: 'BSc', field: 'Computer Science' }],
    certifications: [{ name: 'AWS Certified Solutions Architect' }],
    ...overrides,
  });
}

describe('validateNoFabrication — legitimate tailoring', () => {
  it('accepts an unchanged document', () => {
    expect(validateNoFabrication(cv(), cv()).ok).toBe(true);
  });

  it('accepts rewritten bullet wording that keeps the same figures', () => {
    const tailored = cv({
      experience: [
        {
          company: 'Acme Systems',
          title: 'Senior Backend Engineer',
          startDate: { raw: 'Mar 2022', year: 2022, month: 3 },
          isCurrent: true,
          bullets: ['Reduced p95 latency 840ms to 120ms across checkout', 'Mentored 4 engineers'],
        },
      ],
    });

    expect(validateNoFabrication(cv(), tailored).ok).toBe(true);
  });

  it('accepts a rewritten summary', () => {
    expect(validateNoFabrication(cv(), cv({ summary: 'Django and FastAPI specialist.' })).ok).toBe(true);
  });

  it('accepts REMOVING a role, which is what shortening a CV means', () => {
    expect(validateNoFabrication(cv(), cv({ experience: [] })).ok).toBe(true);
  });

  it('accepts regrouping skills that already exist', () => {
    const tailored = cv({
      skillGroups: [{ category: 'Backend', skills: ['Python'] }, { category: 'Other', skills: ['TypeScript'] }],
    });
    expect(validateNoFabrication(cv(), tailored).ok).toBe(true);
  });

  it('accepts a skill evidenced in a bullet but absent from the skills section', () => {
    // Surfacing something the CV already demonstrates is reorganisation, which
    // is exactly what tailoring is for.
    const source = cv({
      experience: [
        {
          company: 'Acme Systems',
          title: 'Senior Backend Engineer',
          isCurrent: true,
          bullets: ['Built the deployment pipeline in Terraform'],
        },
      ],
    });
    const tailored = cv({
      skillGroups: [{ skills: ['Terraform'] }],
      experience: source.experience,
    });

    expect(validateNoFabrication(source, tailored).ok).toBe(true);
  });

  it('accepts reordering sections', () => {
    const tailored = cv({ sectionOrder: ['skills', 'summary', 'experience'] });
    expect(validateNoFabrication(cv(), tailored).ok).toBe(true);
  });
});

describe('validateNoFabrication — fabrication is rejected', () => {
  it('rejects an invented employer', () => {
    const tailored = cv({
      experience: [
        ...cv().experience,
        { company: 'Google', title: 'Engineer', isCurrent: false, bullets: [] },
      ],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'employer' && f.detail.includes('Google'))).toBe(true);
  });

  it('rejects a promoted job title', () => {
    const tailored = cv({
      experience: [{ ...cv().experience[0]!, title: 'Principal Backend Engineer' }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.kind).toBe('job-title');
  });

  it('rejects a changed employment date', () => {
    const tailored = cv({
      experience: [{ ...cv().experience[0]!, startDate: { raw: 'Mar 2019', year: 2019, month: 3 } }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'date')).toBe(true);
  });

  it('rejects an invented degree', () => {
    const tailored = cv({
      education: [{ institution: 'University of the Punjab', qualification: 'MSc', field: 'Machine Learning', bullets: [] }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'qualification')).toBe(true);
  });

  it('rejects an invented institution', () => {
    const tailored = cv({
      education: [{ institution: 'Stanford University', qualification: 'BSc', field: 'Computer Science', bullets: [] }],
    });

    expect(validateNoFabrication(cv(), tailored).findings.some((f) => f.kind === 'institution')).toBe(true);
  });

  it('rejects an invented certification', () => {
    const tailored = cv({
      certifications: [{ name: 'AWS Certified Solutions Architect' }, { name: 'Google Cloud Professional Architect' }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'certification')).toBe(true);
  });

  it('rejects a skill with no basis anywhere in the CV', () => {
    const tailored = cv({
      skillGroups: [{ category: 'Languages', skills: ['Python', 'TypeScript', 'Kubernetes'] }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'skill' && f.detail.includes('Kubernetes'))).toBe(true);
  });

  it('rejects an inflated metric', () => {
    // The single most tempting fabrication: same claim, better number.
    const tailored = cv({
      experience: [
        { ...cv().experience[0]!, bullets: ['Cut p95 latency from 840ms to 120ms', 'Mentored 40 junior engineers'] },
      ],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.kind === 'metric' && f.detail.includes('40'))).toBe(true);
  });

  it('rejects an invented percentage', () => {
    const tailored = cv({
      experience: [{ ...cv().experience[0]!, bullets: ['Improved throughput by 85%'] }],
    });

    expect(validateNoFabrication(cv(), tailored).findings.some((f) => f.kind === 'metric')).toBe(true);
  });

  it('rejects a changed name or email', () => {
    const tailored = cv({ personal: { fullName: 'Usama N. Khan', links: [] } });
    expect(validateNoFabrication(cv(), tailored).ok).toBe(false);
  });

  it('reports every problem at once rather than stopping at the first', () => {
    const tailored = cv({
      experience: [{ company: 'Google', title: 'Staff Engineer', isCurrent: false, bullets: [] }],
      certifications: [{ name: 'CKA' }],
    });

    const result = validateNoFabrication(cv(), tailored);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
  });
});

describe('extractNumbers', () => {
  it('picks up metrics that are checkable claims', () => {
    expect(extractNumbers('Cut latency by 40% and served 1,200 requests')).toEqual(
      expect.arrayContaining(['40%', '1,200']),
    );
  });

  it('ignores years, which are dates and checked separately', () => {
    expect(extractNumbers('Worked there from 2019 to 2022')).toEqual([]);
  });

  it('ignores small bare counts, which rewording moves between words and digits', () => {
    expect(extractNumbers('Led 4 engineers')).toEqual([]);
  });

  it('keeps a small number carrying a unit', () => {
    expect(extractNumbers('Delivered 3x throughput')).toEqual(['3x']);
  });
});
