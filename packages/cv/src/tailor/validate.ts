import type { CvCertificationItem, CvDocument, CvEducationItem, CvExperienceItem } from '../schema';

/**
 * Anti-fabrication validation.
 *
 * The tailoring prompt tells the model not to invent anything. This checks
 * whether it obeyed. Prompts are guidance; this is enforcement — and it is the
 * reason the feature can be shipped at all, because a CV that quietly gains an
 * employer or a degree is a document that gets someone fired, not merely a bad
 * output.
 *
 * The rule is asymmetric on purpose. REMOVING content is legitimate tailoring:
 * dropping an irrelevant role shortens the CV. ADDING a verifiable fact is
 * never legitimate, because there is nowhere it could have come from.
 *
 * Only checks facts a third party could verify — employers, titles, dates,
 * qualifications, certifications. Prose is meant to be rewritten, so bullet
 * wording is not compared; the numbers inside bullets are, since an inflated
 * metric is a fabricated claim.
 */

export type FabricationKind =
  | 'employer'
  | 'job-title'
  | 'date'
  | 'qualification'
  | 'institution'
  | 'certification'
  | 'skill'
  | 'metric';

export interface FabricationFinding {
  readonly kind: FabricationKind;
  readonly detail: string;
  /** Where in the tailored document it appeared. */
  readonly path: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly findings: FabricationFinding[];
}

/**
 * Compares a tailored CV against its source.
 *
 * Returns every problem rather than the first, so a failure can be reported
 * and investigated in one pass instead of one round trip per issue.
 */
export function validateNoFabrication(source: CvDocument, tailored: CvDocument): ValidationResult {
  const findings: FabricationFinding[] = [
    ...checkExperience(source.experience, tailored.experience),
    ...checkEducation(source.education, tailored.education),
    ...checkCertifications(source.certifications, tailored.certifications),
    ...checkSkills(source, tailored),
    ...checkIdentity(source, tailored),
  ];

  return { ok: findings.length === 0, findings };
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function checkExperience(
  source: readonly CvExperienceItem[],
  tailored: readonly CvExperienceItem[],
): FabricationFinding[] {
  const findings: FabricationFinding[] = [];
  const sourceByCompany = new Map(source.map((role) => [normalise(role.company), role]));

  tailored.forEach((role, index) => {
    const path = `experience[${index}]`;
    const original = sourceByCompany.get(normalise(role.company));

    if (!original) {
      findings.push({
        kind: 'employer',
        detail: `"${role.company}" does not appear in the source CV.`,
        path,
      });
      return;
    }

    // A retitled role is a changed fact about employment history, not a
    // rewording, so it is rejected even though the employer is real.
    if (role.title && original.title && normalise(role.title) !== normalise(original.title)) {
      findings.push({
        kind: 'job-title',
        detail: `Title at ${role.company} changed from "${original.title}" to "${role.title}".`,
        path: `${path}.title`,
      });
    }

    for (const field of ['startDate', 'endDate'] as const) {
      const before = original[field]?.raw;
      const after = role[field]?.raw;
      if (after && before && normalise(after) !== normalise(before)) {
        findings.push({
          kind: 'date',
          detail: `${field} at ${role.company} changed from "${before}" to "${after}".`,
          path: `${path}.${field}`,
        });
      }
      if (after && !before) {
        findings.push({
          kind: 'date',
          detail: `${field} at ${role.company} was added; the source CV has none.`,
          path: `${path}.${field}`,
        });
      }
    }

    findings.push(...checkMetrics(original, role, path));
  });

  return findings;
}

/**
 * Numbers inside bullets are claims: "cut latency by 40%" and "led a team of
 * 12" are checkable facts. Rewording is expected, so the bullets are compared
 * as a pool of numbers rather than line by line — a number appearing in the
 * output that appears nowhere in the source is an invented metric.
 */
function checkMetrics(
  source: CvExperienceItem,
  tailored: CvExperienceItem,
  path: string,
): FabricationFinding[] {
  const sourceNumbers = new Set(extractNumbers(source.bullets.join(' ')));
  const findings: FabricationFinding[] = [];

  for (const value of extractNumbers(tailored.bullets.join(' '))) {
    if (!sourceNumbers.has(value)) {
      findings.push({
        kind: 'metric',
        detail: `The figure "${value}" at ${tailored.company} does not appear in the source CV.`,
        path: `${path}.bullets`,
      });
    }
  }

  return findings;
}

/**
 * Years are excluded: they are usually dates rather than metrics, and dates
 * are checked separately with better context. Small counts under ten are also
 * ignored, since ordinary rewording ("three services" from "3 services")
 * legitimately moves them between words and digits.
 */
export function extractNumbers(text: string): string[] {
  const found: string[] = [];

  for (const match of text.matchAll(/\b(\d[\d,.]*)\s*(%|k\b|m\b|x\b)?/gi)) {
    const raw = match[1];
    if (!raw) continue;

    const numeric = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(numeric)) continue;
    if (numeric >= 1900 && numeric <= 2100 && !match[2]) continue;
    if (numeric < 10 && !match[2]) continue;

    found.push(`${raw}${match[2] ?? ''}`.toLowerCase());
  }

  return found;
}

function checkEducation(
  source: readonly CvEducationItem[],
  tailored: readonly CvEducationItem[],
): FabricationFinding[] {
  const findings: FabricationFinding[] = [];
  const institutions = new Set(source.map((item) => normalise(item.institution)));
  const qualifications = new Set(
    source.map((item) => normalise(`${item.qualification ?? ''} ${item.field ?? ''}`)),
  );

  tailored.forEach((item, index) => {
    const path = `education[${index}]`;

    if (!institutions.has(normalise(item.institution))) {
      findings.push({
        kind: 'institution',
        detail: `"${item.institution}" does not appear in the source CV.`,
        path,
      });
    }

    const combined = normalise(`${item.qualification ?? ''} ${item.field ?? ''}`);
    if (combined && !qualifications.has(combined)) {
      findings.push({
        kind: 'qualification',
        detail: `"${item.qualification ?? ''} ${item.field ?? ''}".trim() does not appear in the source CV.`,
        path,
      });
    }
  });

  return findings;
}

function checkCertifications(
  source: readonly CvCertificationItem[],
  tailored: readonly CvCertificationItem[],
): FabricationFinding[] {
  const known = new Set(source.map((item) => normalise(item.name)));

  return tailored
    .filter((item) => !known.has(normalise(item.name)))
    .map((item, index) => ({
      kind: 'certification' as const,
      detail: `"${item.name}" does not appear in the source CV.`,
      path: `certifications[${index}]`,
    }));
}

/**
 * Skills may be regrouped and reordered but not added.
 *
 * A skill is also accepted if it appears anywhere in the source CV's prose —
 * a bullet reading "built the deployment pipeline in Terraform" evidences
 * Terraform even when the skills section omits it. Surfacing that is
 * reorganisation, which is exactly what tailoring is for.
 */
function checkSkills(source: CvDocument, tailored: CvDocument): FabricationFinding[] {
  const evidence = normalise(
    [
      source.skillGroups.flatMap((group) => group.skills).join(' '),
      source.summary ?? '',
      source.experience.flatMap((role) => [role.title, ...role.bullets]).join(' '),
      source.projects.flatMap((project) => [project.name, project.description ?? '', ...project.technologies, ...project.bullets]).join(' '),
      source.certifications.map((item) => item.name).join(' '),
      source.achievements.join(' '),
    ].join(' '),
  );

  const findings: FabricationFinding[] = [];

  tailored.skillGroups.forEach((group, groupIndex) => {
    group.skills.forEach((skill, skillIndex) => {
      if (!evidence.includes(normalise(skill))) {
        findings.push({
          kind: 'skill',
          detail: `"${skill}" is not evidenced anywhere in the source CV.`,
          path: `skillGroups[${groupIndex}].skills[${skillIndex}]`,
        });
      }
    });
  });

  return findings;
}

/** The person's name and contact details are facts, not copy to optimise. */
function checkIdentity(source: CvDocument, tailored: CvDocument): FabricationFinding[] {
  const findings: FabricationFinding[] = [];

  const fields = [
    ['fullName', source.personal.fullName, tailored.personal.fullName],
    ['email', source.personal.email, tailored.personal.email],
    ['phone', source.personal.phone, tailored.personal.phone],
  ] as const;

  for (const [field, before, after] of fields) {
    if (after && normalise(after) !== normalise(before ?? '')) {
      findings.push({
        kind: 'employer',
        detail: `personal.${field} was changed from "${before ?? '(none)'}" to "${after}".`,
        path: `personal.${field}`,
      });
    }
  }

  return findings;
}
