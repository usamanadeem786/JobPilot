import type { CvDocument, CvExperienceItem, CvSection } from '../schema';
import { SECTION_HEADINGS, type TemplateStyle } from './templates';

/**
 * A renderer-independent description of the page.
 *
 * Both writers consume this rather than walking the CV themselves, so DOCX and
 * PDF always contain the same content in the same order. Without it the two
 * drift, and the drift is invisible until someone downloads both and compares.
 */

export type Block =
  | { readonly kind: 'name'; readonly text: string }
  | { readonly kind: 'contact'; readonly parts: string[] }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'bullet'; readonly text: string }
  | {
      readonly kind: 'entry';
      readonly primary: string;
      readonly secondary?: string;
      readonly trailing?: string;
    };

/** Renders a CV date range the way a CV writes it, or nothing at all. */
export function formatPeriod(
  start: { raw: string } | undefined,
  end: { raw: string } | undefined,
  isCurrent: boolean,
): string | undefined {
  const from = start?.raw;
  const to = isCurrent ? 'Present' : end?.raw;

  if (from && to) return `${from} – ${to}`;
  return from ?? to ?? undefined;
}

function experienceBlocks(items: readonly CvExperienceItem[]): Block[] {
  return items.flatMap<Block>((role) => {
    const period = formatPeriod(role.startDate, role.endDate, role.isCurrent);
    const secondary = [role.company, role.location].filter(Boolean).join(' · ');

    return [
      {
        kind: 'entry',
        primary: role.title || role.company,
        ...(role.title ? { secondary } : {}),
        ...(period ? { trailing: period } : {}),
      },
      ...role.bullets.map((text) => ({ kind: 'bullet' as const, text })),
    ];
  });
}

/**
 * Turns a CV and a template into an ordered block list.
 *
 * Empty sections are skipped entirely rather than rendered as a bare heading,
 * because a CV with an empty "Certifications" heading reads as unfinished.
 */
export function layoutCv(document: CvDocument, template: TemplateStyle): Block[] {
  const blocks: Block[] = [{ kind: 'name', text: document.personal.fullName }];

  const contact = [
    document.personal.headline,
    document.personal.location,
    document.personal.email,
    document.personal.phone,
    ...document.personal.links.map((link) => link.url),
  ].filter((value): value is string => Boolean(value));

  if (contact.length > 0) blocks.push({ kind: 'contact', parts: contact });

  // The document's own order wins when it has one — tailoring reorders
  // sections deliberately — otherwise the template's default applies.
  const order = document.sectionOrder.length > 0 ? document.sectionOrder : template.sectionOrder;

  for (const section of order) {
    const body = sectionBlocks(section, document);
    if (body.length === 0) continue;

    blocks.push({ kind: 'heading', text: SECTION_HEADINGS[section] }, ...body);
  }

  return blocks;
}

function sectionBlocks(section: CvSection, document: CvDocument): Block[] {
  switch (section) {
    case 'summary':
      return document.summary ? [{ kind: 'paragraph', text: document.summary }] : [];

    case 'skills':
      return document.skillGroups
        .filter((group) => group.skills.length > 0)
        .map((group) => ({
          kind: 'paragraph' as const,
          text: group.category ? `${group.category}: ${group.skills.join(', ')}` : group.skills.join(', '),
        }));

    case 'experience':
      return experienceBlocks(document.experience);

    case 'projects':
      return document.projects.flatMap<Block>((project) => [
        {
          kind: 'entry',
          primary: project.name,
          ...(project.technologies.length > 0 ? { secondary: project.technologies.join(', ') } : {}),
        },
        ...(project.description ? [{ kind: 'paragraph' as const, text: project.description }] : []),
        ...project.bullets.map((text) => ({ kind: 'bullet' as const, text })),
      ]);

    case 'education':
      return document.education.flatMap<Block>((item) => {
        const qualification = [item.qualification, item.field].filter(Boolean).join(', ');
        const period = formatPeriod(item.startDate, item.endDate, false);

        return [
          {
            kind: 'entry',
            primary: qualification || item.institution,
            ...(qualification ? { secondary: item.institution } : {}),
            ...(period ? { trailing: period } : {}),
          },
          ...(item.grade ? [{ kind: 'paragraph' as const, text: item.grade }] : []),
          ...item.bullets.map((text) => ({ kind: 'bullet' as const, text })),
        ];
      });

    case 'certifications':
      return document.certifications.map((item) => ({
        kind: 'bullet' as const,
        text: [item.name, item.issuer, item.issuedAt?.raw].filter(Boolean).join(' · '),
      }));

    case 'achievements':
      return document.achievements.map((text) => ({ kind: 'bullet' as const, text }));
  }
}
