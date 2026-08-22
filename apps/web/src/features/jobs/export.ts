import {
  EMPLOYMENT_TYPE_LABELS,
  formatSalary,
  JOB_STATUS_LABELS,
  REMOTE_TYPE_LABELS,
  type JobListItemDto,
} from '@jobpilot/shared';

/**
 * CSV export.
 *
 * Written by hand rather than pulled from a library because the escaping rules
 * are short and the security consideration below is specific enough that a
 * generic library would not apply it.
 */

const COLUMNS: readonly { header: string; value: (job: JobListItemDto) => string }[] = [
  { header: 'Title', value: (job) => job.title },
  { header: 'Company', value: (job) => job.companyName },
  { header: 'Location', value: (job) => job.location ?? '' },
  { header: 'Remote', value: (job) => REMOTE_TYPE_LABELS[job.remoteType] },
  { header: 'Employment type', value: (job) => EMPLOYMENT_TYPE_LABELS[job.employmentType] },
  { header: 'Salary', value: (job) => formatSalary(job.salary) ?? '' },
  { header: 'Source', value: (job) => job.sourceDisplayName },
  // Blank rather than the discovery date: a spreadsheet column headed "Posted"
  // implies the source published that date, and for many sources it did not.
  { header: 'Posted', value: (job) => (job.postedAtKnown ? (job.postedAt ?? '') : '') },
  { header: 'Discovered', value: (job) => job.discoveredAt },
  { header: 'Match %', value: (job) => (job.relevanceScore === null ? '' : String(job.relevanceScore)) },
  { header: 'Status', value: (job) => JOB_STATUS_LABELS[job.status] },
  { header: 'Recruiter', value: (job) => job.contact?.name ?? '' },
  { header: 'Recruiter email', value: (job) => job.contact?.email ?? '' },
  { header: 'Contact verified', value: (job) => (job.contact ? String(job.contact.provenance === 'VERIFIED') : '') },
  { header: 'Job URL', value: (job) => job.jobUrl },
  { header: 'Application URL', value: (job) => job.applicationUrl },
];

/**
 * Escapes one CSV field.
 *
 * The leading apostrophe is a CSV-injection defence, not a formatting quirk: a
 * field starting with =, +, - or @ is executed as a formula when the file is
 * opened in Excel or Sheets. Job titles and company names come from third
 * parties, so they are exactly the untrusted input that attack needs.
 */
export function escapeCsvField(value: string): string {
  const neutralised = neutraliseFormula(value);
  return `"${neutralised.replace(/"/g, '""')}"`;
}

export function jobsToCsv(jobs: readonly JobListItemDto[]): string {
  const header = COLUMNS.map((column) => escapeCsvField(column.header)).join(',');
  const rows = jobs.map((job) =>
    COLUMNS.map((column) => escapeCsvField(column.value(job) ?? '')).join(','),
  );

  // A BOM, so Excel opens UTF-8 correctly instead of mangling accented names.
  return `\uFEFF${[header, ...rows].join('\r\n')}`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Excel export.
 *
 * ExcelJS is loaded with a dynamic import so its considerable weight is only
 * paid by someone who actually clicks the button, rather than by every visitor
 * who loads the jobs page. CSV covers the common case and costs nothing.
 */
export async function downloadXlsx(filename: string, jobs: readonly JobListItemDto[]): Promise<void> {
  const ExcelJS = await import('exceljs');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'JobPilot';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Jobs', {
    // Freezing the header keeps it visible while scrolling a few hundred rows,
    // which is the normal size of a search.
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = COLUMNS.map((column) => ({
    header: column.header,
    key: column.header,
    width: Math.min(48, Math.max(12, column.header.length + 6)),
  }));

  sheet.getRow(1).font = { bold: true };

  for (const job of jobs) {
    // The same CSV-injection defence applies: Excel evaluates a leading =, +,
    // - or @ as a formula, and these values come from third-party job boards.
    sheet.addRow(COLUMNS.map((column) => neutraliseFormula(column.value(job) ?? '')));
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    filename,
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
}

/** Shared by both exports: a leading formula character is neutralised. */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
