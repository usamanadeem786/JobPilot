'use client';

import {
  JOB_STATUS_LABELS,
  type JobListItemDto,
  type JobListQuery,
  type JobSortField,
} from '@jobpilot/shared';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown, Columns3, Download, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { buildJobColumns, JOB_COLUMN_LABELS, type JobColumnActions } from './columns';
import { downloadCsv, jobsToCsv } from './export';

export interface JobsTableProps {
  readonly jobs: readonly JobListItemDto[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly isLoading: boolean;
  readonly query: JobListQuery;
  onQueryChange(next: Partial<JobListQuery>): void;
  readonly actions: JobColumnActions;
  onBulkStatus(jobIds: string[], status: JobListItemDto['status']): void;
  onBulkGenerateCv(jobIds: string[]): void;
}

/**
 * The jobs dashboard table.
 *
 * Sorting, filtering and pagination are all SERVER-side: the table renders one
 * page and reports intent upward. Doing it client-side would mean shipping
 * every row to the browser to sort them, which stops working at the scale this
 * product is for — a few hundred jobs per search, thousands over time.
 */
export function JobsTable(props: JobsTableProps): React.ReactElement {
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = React.useState<Record<string, boolean>>({});
  const [showColumns, setShowColumns] = React.useState(false);

  const columns = React.useMemo(() => buildJobColumns(props.actions), [props.actions]);

  const sorting = React.useMemo<SortingState>(
    () => [{ id: props.query.sortBy, desc: props.query.sortOrder === 'desc' }],
    [props.query.sortBy, props.query.sortOrder],
  );

  const table = useReactTable({
    data: props.jobs as JobListItemDto[],
    columns,
    state: { columnVisibility, columnFilters, rowSelection, sorting },
    // The row id must be the job id, not the array index, or a selection
    // silently moves to a different job when the page reorders.
    getRowId: (row) => row.id,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.max(1, Math.ceil(props.total / props.pageSize)),
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const totalPages = Math.max(1, Math.ceil(props.total / props.pageSize));

  const toggleSort = (field: string): void => {
    const sortable = SORTABLE_FIELDS.has(field as JobSortField);
    if (!sortable) return;

    props.onQueryChange({
      sortBy: field as JobSortField,
      sortOrder: props.query.sortBy === field && props.query.sortOrder === 'desc' ? 'asc' : 'desc',
      page: 1,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        query={props.query}
        onQueryChange={props.onQueryChange}
        selectedCount={selectedIds.length}
        onClearSelection={() => setRowSelection({})}
        onExport={() => {
          const rows =
            selectedIds.length > 0
              ? props.jobs.filter((jobItem) => selectedIds.includes(jobItem.id))
              : props.jobs;
          downloadCsv(`jobpilot-jobs-${new Date().toISOString().slice(0, 10)}.csv`, jobsToCsv(rows));
        }}
        onBulkStatus={(status) => props.onBulkStatus(selectedIds, status)}
        onBulkGenerateCv={() => props.onBulkGenerateCv(selectedIds)}
        showColumns={showColumns}
        onToggleColumnMenu={() => setShowColumns((open) => !open)}
      />

      {showColumns ? (
        <ColumnMenu table={table} onClose={() => setShowColumns(false)} />
      ) : null}

      {/* The table scrolls inside its own container so the page never scrolls
          horizontally on a narrow screen. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortable = SORTABLE_FIELDS.has(header.column.id as JobSortField);
                  const isSorted = props.query.sortBy === header.column.id;

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      style={{ width: header.getSize() }}
                      aria-sort={
                        isSorted ? (props.query.sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(header.column.id)}
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {isSorted ? (
                            props.query.sortOrder === 'asc' ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : (
                              <ArrowDown className="size-3" aria-hidden />
                            )
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {props.isLoading ? (
              <LoadingRows columns={table.getVisibleLeafColumns().length} />
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length} className="px-3 py-16 text-center">
                  <p className="text-sm font-medium">No jobs found for this search.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try broader keywords, or configure more job sources in settings.
                  </p>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  className={cn(
                    'border-t border-border align-top transition-colors hover:bg-accent/40',
                    row.getIsSelected() && 'bg-accent/60',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={props.page}
        pageSize={props.pageSize}
        total={props.total}
        totalPages={totalPages}
        onQueryChange={props.onQueryChange}
      />
    </div>
  );
}

const SORTABLE_FIELDS = new Set<JobSortField>([
  'title',
  'companyName',
  'postedAt',
  'relevanceScore',
  'status',
]);

interface ToolbarProps {
  readonly query: JobListQuery;
  onQueryChange(next: Partial<JobListQuery>): void;
  readonly selectedCount: number;
  onClearSelection(): void;
  onExport(): void;
  onBulkStatus(status: JobListItemDto['status']): void;
  onBulkGenerateCv(): void;
  readonly showColumns: boolean;
  onToggleColumnMenu(): void;
}

function Toolbar(props: ToolbarProps): React.ReactElement {
  const [search, setSearch] = React.useState(props.query.search ?? '');

  // Debounced so typing does not fire a request per keystroke.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if ((props.query.search ?? '') !== search) {
        props.onQueryChange({ search: search || undefined, page: 1 });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [search, props]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search title, company or description"
          aria-label="Search jobs"
          className="w-full sm:max-w-xs"
        />

        <Select
          aria-label="Filter by status"
          value={props.query.status?.[0] ?? ''}
          onChange={(event) =>
            props.onQueryChange({
              status: event.target.value ? [event.target.value as JobListItemDto['status']] : undefined,
              page: 1,
            })
          }
        >
          <option value="">All statuses</option>
          {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by remote type"
          value={props.query.remoteType?.[0] ?? ''}
          onChange={(event) =>
            props.onQueryChange({
              remoteType: event.target.value
                ? [event.target.value as JobListItemDto['remoteType']]
                : undefined,
              page: 1,
            })
          }
        >
          <option value="">Anywhere</option>
          <option value="REMOTE">Remote</option>
          <option value="HYBRID">Hybrid</option>
          <option value="ONSITE">On-site</option>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={props.onToggleColumnMenu} aria-expanded={props.showColumns}>
            <Columns3 className="size-4" aria-hidden />
            Columns
          </Button>
          <Button variant="outline" size="sm" onClick={props.onExport}>
            <Download className="size-4" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>

      {props.selectedCount > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
        >
          <Badge>{props.selectedCount} selected</Badge>

          <Select
            aria-label="Set status for selected jobs"
            value=""
            onChange={(event) => {
              if (event.target.value) props.onBulkStatus(event.target.value as JobListItemDto['status']);
            }}
          >
            <option value="">Set status…</option>
            {Object.entries(JOB_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>

          <Button size="sm" variant="outline" onClick={props.onBulkGenerateCv}>
            Generate {props.selectedCount} CVs
          </Button>
          <Button size="sm" variant="ghost" onClick={props.onClearSelection}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ColumnMenu({
  table,
  onClose,
}: {
  table: ReturnType<typeof useReactTable<JobListItemDto>>;
  onClose(): void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
      {table
        .getAllLeafColumns()
        .filter((column) => column.getCanHide())
        .map((column) => (
          <label key={column.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={column.getIsVisible()}
              onChange={(event) => column.toggleVisibility(event.target.checked)}
            />
            {JOB_COLUMN_LABELS[column.id] ?? column.id}
          </label>
        ))}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}

function LoadingRows({ columns }: { columns: number }): React.ReactElement {
  return (
    <>
      {Array.from({ length: 6 }).map((_, rowIndex) => (
        <tr key={rowIndex} className="border-t border-border">
          {Array.from({ length: columns }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-3 py-3">
              <Skeleton className="h-4 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onQueryChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onQueryChange(next: Partial<JobListQuery>): void;
}): React.ReactElement {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        {total === 0 ? 'No jobs' : `Showing ${first}–${last} of ${total}`}
      </p>

      <div className="flex items-center gap-2">
        <Select
          aria-label="Rows per page"
          value={String(pageSize)}
          onChange={(event) => onQueryChange({ pageSize: Number(event.target.value), page: 1 })}
        >
          {[25, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </Select>

        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onQueryChange({ page: page - 1 })}
        >
          Previous
        </Button>
        <span className="tabular-nums text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onQueryChange({ page: page + 1 })}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export { Loader2 };
