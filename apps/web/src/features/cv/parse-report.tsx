'use client';

import type { CvUploadResultDto, MasterCvDetailDto } from '@jobpilot/shared';
import * as React from 'react';

const SECTION_NAMES: Record<string, string> = {
  personal: 'your name and contact details',
  summary: 'a professional summary',
  skills: 'a skills section',
  experience: 'work experience',
  education: 'education',
  projects: 'projects',
  certifications: 'certifications',
  achievements: 'achievements',
};

interface ParseReportProps {
  readonly cv: MasterCvDetailDto;
  /** Present only just after an upload, while the document is still in mind. */
  readonly uploadReport: CvUploadResultDto | null;
}

/**
 * What the parser did and did not find.
 *
 * A CV is read by machine and the result is never perfect. Stating the gaps
 * outright is the difference between a user who fixes three fields and one who
 * sends an employer a CV with its education section quietly missing. Nothing
 * here is filled in on the user's behalf: a section that was not found stays
 * empty and is reported as empty.
 */
export function ParseReport({ cv, uploadReport }: ParseReportProps): React.ReactElement | null {
  const missing = React.useMemo(() => {
    if (uploadReport) return uploadReport.missingSections;
    if (!cv.parseProvenance) return [];
    return Object.entries(cv.parseProvenance)
      .filter(([, provenance]) => provenance === 'NOT_FOUND')
      .map(([section]) => section);
  }, [cv.parseProvenance, uploadReport]);

  const warnings = uploadReport?.warnings ?? [];

  // A CV typed in by hand has nothing to report: there was no parse.
  if (!cv.parsedAt && !uploadReport) return null;
  if (missing.length === 0 && warnings.length === 0) {
    return (
      <p
        role="status"
        className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      >
        Every section was found in your document. Check the details below are right — reading a CV
        by machine is never exact.
      </p>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
    >
      {missing.length > 0 ? (
        <div>
          <p className="font-medium">Some sections could not be read from your file</p>
          <p className="mt-1 text-muted-foreground">
            We could not find {joinWords(missing.map((section) => SECTION_NAMES[section] ?? section))}
            . They have been left empty rather than guessed — add them below if your CV has them.
          </p>
        </div>
      ) : null}

      {warnings.map((warning, index) => (
        <p key={index} className="text-muted-foreground">
          {warning}
        </p>
      ))}
    </div>
  );
}

/** "a, b and c" — an Oxford-comma-free list that reads as a sentence. */
function joinWords(words: readonly string[]): string {
  if (words.length === 0) return '';
  if (words.length === 1) return words[0] as string;
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) as string}`;
}
