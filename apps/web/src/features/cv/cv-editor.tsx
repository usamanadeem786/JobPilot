'use client';

import {
  CV_SECTIONS,
  emptyCvDocument,
  type CvDocument,
  type CvEducationItem,
  type CvExperienceItem,
  type CvProjectItem,
  type CvSection,
} from '@jobpilot/cv/schema';
import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BulletList, EntryCard, Repeater, TextField } from './fields';

/**
 * The CV editor.
 *
 * The whole document is one piece of state held by the page above, and every
 * field reports a complete replacement upward. That is more copying than a
 * per-field form would do, and it buys the thing that matters: there is
 * exactly one object to validate, autosave and render, so what the user sees
 * and what gets saved cannot drift apart.
 */

interface CvEditorProps {
  readonly document: CvDocument;
  readonly onChange: (document: CvDocument) => void;
}

/** Replaces one entry in a list without mutating the original. */
function replaceAt<T>(items: readonly T[], index: number, next: T): T[] {
  return items.map((item, position) => (position === index ? next : item));
}

function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, position) => position !== index);
}

export function CvEditor({ document, onChange }: CvEditorProps): React.ReactElement {
  const patch = React.useCallback(
    (changes: Partial<CvDocument>) => onChange({ ...document, ...changes }),
    [document, onChange],
  );

  return (
    <div className="flex flex-col gap-8">
      <PersonalSection document={document} patch={patch} />

      <section className="flex flex-col gap-3" aria-label="Professional summary">
        <h2 className="text-base font-semibold">Professional summary</h2>
        <TextField
          label="Summary"
          multiline
          rows={5}
          value={document.summary ?? ''}
          placeholder="Two or three sentences on what you do and what you are looking for."
          onChange={(value) => patch({ summary: value })}
        />
      </section>

      <SkillsSection document={document} patch={patch} />
      <ExperienceSection document={document} patch={patch} />
      <EducationSection document={document} patch={patch} />
      <ProjectsSection document={document} patch={patch} />
      <CertificationsSection document={document} patch={patch} />

      <section className="flex flex-col gap-3" aria-label="Achievements">
        <h2 className="text-base font-semibold">Achievements</h2>
        <BulletList
          label="Achievements"
          bullets={document.achievements}
          addLabel="Add an achievement"
          onChange={(achievements) => patch({ achievements })}
        />
      </section>

      <SectionOrder document={document} patch={patch} />
    </div>
  );
}

type PatchFn = (changes: Partial<CvDocument>) => void;

function PersonalSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const personal = document.personal;
  const setPersonal = (changes: Partial<CvDocument['personal']>): void =>
    patch({ personal: { ...personal, ...changes } });

  return (
    <section className="flex flex-col gap-4" aria-label="Personal details">
      <h2 className="text-base font-semibold">Personal details</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Full name"
          value={personal.fullName}
          onChange={(fullName) => setPersonal({ fullName })}
        />
        <TextField
          label="Headline"
          value={personal.headline ?? ''}
          placeholder="Senior Backend Engineer"
          onChange={(headline) => setPersonal({ headline })}
        />
        <TextField
          label="Email"
          value={personal.email ?? ''}
          onChange={(email) => setPersonal({ email })}
        />
        <TextField
          label="Phone"
          value={personal.phone ?? ''}
          onChange={(phone) => setPersonal({ phone })}
        />
        <TextField
          label="Location"
          value={personal.location ?? ''}
          placeholder="Lahore, Pakistan"
          onChange={(location) => setPersonal({ location })}
          className="sm:col-span-2"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Links</Label>
        {personal.links.length === 0 ? (
          <p className="text-xs text-muted-foreground">No links yet.</p>
        ) : null}

        {personal.links.map((link, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              value={link.label}
              aria-label={`Link ${index + 1} label`}
              placeholder="GitHub"
              onChange={(event) =>
                setPersonal({
                  links: replaceAt(personal.links, index, { ...link, label: event.target.value }),
                })
              }
            />
            <Input
              className="min-w-0 flex-1"
              value={link.url}
              aria-label={`Link ${index + 1} URL`}
              placeholder="https://github.com/you"
              onChange={(event) =>
                setPersonal({
                  links: replaceAt(personal.links, index, { ...link, url: event.target.value }),
                })
              }
            />
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setPersonal({ links: removeAt(personal.links, index) })}
            >
              Remove
            </button>
          </div>
        ))}

        <div>
          <button
            type="button"
            className="text-sm text-primary underline-offset-4 hover:underline"
            onClick={() => setPersonal({ links: [...personal.links, { label: '', url: '' }] })}
          >
            Add a link
          </button>
        </div>
      </div>
    </section>
  );
}

function SkillsSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const groups = document.skillGroups;

  return (
    <Repeater
      title="Skills"
      count={groups.length}
      addLabel="Add a group"
      emptyMessage="No skills yet. Group them the way your CV does — Languages, Frameworks, Tools."
      onAdd={() => patch({ skillGroups: [...groups, { category: '', skills: [] }] })}
    >
      <div className="flex flex-col gap-3">
        {groups.map((group, index) => (
          <EntryCard
            key={index}
            heading={group.category || 'Ungrouped skills'}
            removeLabel={`Remove skill group ${index + 1}`}
            onRemove={() => patch({ skillGroups: removeAt(groups, index) })}
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <TextField
                label="Category"
                value={group.category ?? ''}
                placeholder="Languages"
                onChange={(category) =>
                  patch({ skillGroups: replaceAt(groups, index, { ...group, category }) })
                }
              />
              <TextField
                label="Skills"
                value={group.skills.join(', ')}
                placeholder="TypeScript, Go, SQL"
                hint="Separated by commas."
                onChange={(value) =>
                  patch({
                    skillGroups: replaceAt(groups, index, {
                      ...group,
                      // Split but not trimmed-and-filtered on every keystroke:
                      // dropping empties as you type eats the comma you just
                      // pressed. The editor cleans up on save.
                      skills: value.split(',').map((skill) => skill.trimStart()),
                    }),
                  })
                }
              />
            </div>
          </EntryCard>
        ))}
      </div>
    </Repeater>
  );
}

const EMPTY_ROLE: CvExperienceItem = {
  company: '',
  title: '',
  isCurrent: false,
  bullets: [],
};

function ExperienceSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const roles = document.experience;
  const set = (index: number, next: CvExperienceItem): void =>
    patch({ experience: replaceAt(roles, index, next) });

  return (
    <Repeater
      title="Experience"
      count={roles.length}
      addLabel="Add a role"
      emptyMessage="No roles yet."
      onAdd={() => patch({ experience: [...roles, EMPTY_ROLE] })}
    >
      <div className="flex flex-col gap-4">
        {roles.map((role, index) => (
          <EntryCard
            key={index}
            heading={[role.title, role.company].filter(Boolean).join(' — ') || 'New role'}
            removeLabel={`Remove role ${index + 1}`}
            onRemove={() => patch({ experience: removeAt(roles, index) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Job title"
                value={role.title}
                onChange={(title) => set(index, { ...role, title })}
              />
              <TextField
                label="Company"
                value={role.company}
                onChange={(company) => set(index, { ...role, company })}
              />
              <TextField
                label="Location"
                value={role.location ?? ''}
                onChange={(location) => set(index, { ...role, location })}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="From"
                  value={role.startDate?.raw ?? ''}
                  placeholder="March 2021"
                  onChange={(raw) => set(index, { ...role, startDate: raw ? { raw } : undefined })}
                />
                <TextField
                  label="To"
                  value={role.endDate?.raw ?? ''}
                  placeholder="Present"
                  onChange={(raw) => set(index, { ...role, endDate: raw ? { raw } : undefined })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={role.isCurrent}
                onChange={(event) => set(index, { ...role, isCurrent: event.target.checked })}
              />
              I still work here
            </label>

            <BulletList
              label="What you did"
              bullets={role.bullets}
              addLabel="Add a bullet"
              onChange={(bullets) => set(index, { ...role, bullets })}
            />
          </EntryCard>
        ))}
      </div>
    </Repeater>
  );
}

const EMPTY_EDUCATION: CvEducationItem = { institution: '', bullets: [] };

function EducationSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const items = document.education;
  const set = (index: number, next: CvEducationItem): void =>
    patch({ education: replaceAt(items, index, next) });

  return (
    <Repeater
      title="Education"
      count={items.length}
      addLabel="Add education"
      emptyMessage="No education yet."
      onAdd={() => patch({ education: [...items, EMPTY_EDUCATION] })}
    >
      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <EntryCard
            key={index}
            heading={item.qualification || item.institution || 'New entry'}
            removeLabel={`Remove education ${index + 1}`}
            onRemove={() => patch({ education: removeAt(items, index) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Institution"
                value={item.institution}
                onChange={(institution) => set(index, { ...item, institution })}
              />
              <TextField
                label="Qualification"
                value={item.qualification ?? ''}
                placeholder="BSc Computer Science"
                onChange={(qualification) => set(index, { ...item, qualification })}
              />
              <TextField
                label="Grade"
                value={item.grade ?? ''}
                placeholder="First class honours"
                onChange={(grade) => set(index, { ...item, grade })}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="From"
                  value={item.startDate?.raw ?? ''}
                  onChange={(raw) => set(index, { ...item, startDate: raw ? { raw } : undefined })}
                />
                <TextField
                  label="To"
                  value={item.endDate?.raw ?? ''}
                  onChange={(raw) => set(index, { ...item, endDate: raw ? { raw } : undefined })}
                />
              </div>
            </div>
          </EntryCard>
        ))}
      </div>
    </Repeater>
  );
}

const EMPTY_PROJECT: CvProjectItem = { name: '', technologies: [], bullets: [] };

function ProjectsSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const items = document.projects;
  const set = (index: number, next: CvProjectItem): void =>
    patch({ projects: replaceAt(items, index, next) });

  return (
    <Repeater
      title="Projects"
      count={items.length}
      addLabel="Add a project"
      emptyMessage="No projects yet."
      onAdd={() => patch({ projects: [...items, EMPTY_PROJECT] })}
    >
      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <EntryCard
            key={index}
            heading={item.name || 'New project'}
            removeLabel={`Remove project ${index + 1}`}
            onRemove={() => patch({ projects: removeAt(items, index) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                value={item.name}
                onChange={(name) => set(index, { ...item, name })}
              />
              <TextField
                label="URL"
                value={item.url ?? ''}
                placeholder="https://github.com/you/project"
                onChange={(url) => set(index, { ...item, url: url || undefined })}
              />
            </div>

            <TextField
              label="Description"
              multiline
              rows={2}
              value={item.description ?? ''}
              onChange={(description) => set(index, { ...item, description })}
            />

            <TextField
              label="Technologies"
              value={item.technologies.join(', ')}
              hint="Separated by commas."
              onChange={(value) =>
                set(index, {
                  ...item,
                  technologies: value.split(',').map((entry) => entry.trimStart()),
                })
              }
            />

            <BulletList
              label="Highlights"
              bullets={item.bullets}
              addLabel="Add a highlight"
              onChange={(bullets) => set(index, { ...item, bullets })}
            />
          </EntryCard>
        ))}
      </div>
    </Repeater>
  );
}

function CertificationsSection({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  const items = document.certifications;

  return (
    <Repeater
      title="Certifications"
      count={items.length}
      addLabel="Add a certification"
      emptyMessage="No certifications yet."
      onAdd={() => patch({ certifications: [...items, { name: '' }] })}
    >
      <div className="flex flex-col gap-4">
        {items.map((item, index) => (
          <EntryCard
            key={index}
            heading={item.name || 'New certification'}
            removeLabel={`Remove certification ${index + 1}`}
            onRemove={() => patch({ certifications: removeAt(items, index) })}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                value={item.name}
                onChange={(name) =>
                  patch({ certifications: replaceAt(items, index, { ...item, name }) })
                }
              />
              <TextField
                label="Issuer"
                value={item.issuer ?? ''}
                onChange={(issuer) =>
                  patch({ certifications: replaceAt(items, index, { ...item, issuer }) })
                }
              />
              <TextField
                label="Issued"
                value={item.issuedAt?.raw ?? ''}
                placeholder="May 2022"
                onChange={(raw) =>
                  patch({
                    certifications: replaceAt(items, index, {
                      ...item,
                      issuedAt: raw ? { raw } : undefined,
                    }),
                  })
                }
              />
              <TextField
                label="Credential URL"
                value={item.credentialUrl ?? ''}
                onChange={(credentialUrl) =>
                  patch({
                    certifications: replaceAt(items, index, {
                      ...item,
                      credentialUrl: credentialUrl || undefined,
                    }),
                  })
                }
              />
            </div>
          </EntryCard>
        ))}
      </div>
    </Repeater>
  );
}

const SECTION_LABELS: Record<(typeof CV_SECTIONS)[number], string> = {
  summary: 'Summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  achievements: 'Achievements',
};

function SectionOrder({
  document,
  patch,
}: {
  document: CvDocument;
  patch: PatchFn;
}): React.ReactElement {
  // Shows what will actually be rendered, including sections added since the
  // CV was parsed. Otherwise a newly added Projects section is missing from
  // this list and the user cannot see, let alone move, something that will
  // appear in their PDF.
  const order = React.useMemo(() => withRenderableSections(document), [document]);

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    patch({ sectionOrder: next });
  };

  return (
    <section className="flex flex-col gap-3" aria-label="Section order">
      <div>
        <h2 className="text-base font-semibold">Section order</h2>
        <p className="text-sm text-muted-foreground">
          The order these appear in the PDF and DOCX you download.
        </p>
      </div>

      <ol className="flex flex-col gap-1">
        {order.map((section, index) => (
          <li
            key={section}
            className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm"
          >
            <span>{SECTION_LABELS[section]}</span>
            <span className="flex gap-1">
              <button
                type="button"
                className="rounded px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                disabled={index === 0}
                aria-label={`Move ${SECTION_LABELS[section]} up`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="rounded px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                disabled={index === order.length - 1}
                aria-label={`Move ${SECTION_LABELS[section]} down`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Strips the empty rows the editor allows while typing.
 *
 * Only blanks are removed. Nothing is added, reworded or reordered — the saved
 * document says exactly what the user typed.
 */
/** Whether a section has anything in it worth rendering. */
function sectionHasContent(document: CvDocument, section: CvSection): boolean {
  switch (section) {
    case 'summary':
      return Boolean(document.summary?.trim());
    case 'skills':
      return document.skillGroups.some((group) => group.skills.length > 0);
    case 'experience':
      return document.experience.length > 0;
    case 'projects':
      return document.projects.length > 0;
    case 'education':
      return document.education.length > 0;
    case 'certifications':
      return document.certifications.length > 0;
    case 'achievements':
      return document.achievements.length > 0;
  }
}

/**
 * Ensures every section that has content appears in the presentation order.
 *
 * The renderer walks `sectionOrder` and nothing else, and the parser only
 * lists the sections it actually found. So a CV uploaded without projects has
 * no "projects" entry - and a project added afterwards in the editor saves
 * correctly, appears on screen, and is then silently missing from the PDF the
 * user sends to an employer. Missing sections are appended in the canonical
 * order; an order the user has already chosen is left untouched.
 */
function withRenderableSections(document: CvDocument): CvSection[] {
  const present = new Set(document.sectionOrder);
  const missing = CV_SECTIONS.filter(
    (section) => !present.has(section) && sectionHasContent(document, section),
  );

  return [...document.sectionOrder, ...missing];
}

export function tidyForSave(document: CvDocument): CvDocument {
  const clean = (values: readonly string[]): string[] =>
    values.map((value) => value.trim()).filter(Boolean);

  return {
    ...document,
    sectionOrder: withRenderableSections(document),
    personal: {
      ...document.personal,
      links: document.personal.links.filter((link) => link.label.trim() && link.url.trim()),
    },
    skillGroups: document.skillGroups
      .map((group) => ({ ...group, skills: clean(group.skills) }))
      .filter((group) => group.skills.length > 0 || (group.category ?? '').trim()),
    // A blank row is a row the user has not filled in yet, not a role at an
    // unnamed company. Sending it fails validation and the whole save is
    // rejected, so the user's other edits are lost to an error message about
    // a field they never typed in. The row stays on screen either way, and
    // joins the next save as soon as it has a name.
    experience: document.experience
      .filter((role) => role.company.trim())
      .map((role) => ({ ...role, bullets: clean(role.bullets) })),
    education: document.education
      .filter((item) => item.institution.trim())
      .map((item) => ({ ...item, bullets: clean(item.bullets) })),
    projects: document.projects
      .filter((project) => project.name.trim())
      .map((project) => ({
        ...project,
        technologies: clean(project.technologies),
        bullets: clean(project.bullets),
      })),
    certifications: document.certifications.filter((item) => item.name.trim()),
    achievements: clean(document.achievements),
  };
}

export { emptyCvDocument };
