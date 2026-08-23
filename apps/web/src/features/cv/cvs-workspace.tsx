'use client';

import { CvDocumentSchema, type CvDocument } from '@jobpilot/cv/schema';
import type {
  CvTemplateDto,
  CvUploadResultDto,
  MasterCvDetailDto,
  MasterCvSummaryDto,
} from '@jobpilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, apiDownload, apiFetch, ConfigurationError } from '@/lib/api-client';
import { CvEditor, tidyForSave } from './cv-editor';
import { CvList } from './cv-list';
import { CvUpload } from './cv-upload';
import { ParseReport } from './parse-report';
import { describeSaveState, useAutosave } from './use-autosave';

/**
 * The CVs page.
 *
 * One master CV is the source of truth for everything downstream — matching,
 * tailoring, applications — so this screen's job is to get an accurate one in
 * and let the user correct whatever the parser got wrong. What the parser
 * could not find is shown rather than hidden, because a silently empty section
 * reads as a bug and an invisible one gets sent to an employer.
 */
export function CvsWorkspace(): React.ReactElement {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [lastUpload, setLastUpload] = React.useState<CvUploadResultDto | null>(null);

  const listQuery = useQuery({
    queryKey: ['cvs'],
    queryFn: () => apiFetch<MasterCvSummaryDto[]>('/cv'),
  });

  const templatesQuery = useQuery({
    queryKey: ['cv-templates'],
    queryFn: () => apiFetch<CvTemplateDto[]>('/cv/templates'),
    staleTime: Infinity,
  });

  const cvs = React.useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Follow the default CV until the user picks one, so the page opens on
  // something rather than an empty pane.
  const activeId = selectedId ?? cvs.find((cv) => cv.isDefault)?.id ?? cvs[0]?.id ?? null;

  const detailQuery = useQuery({
    queryKey: ['cv', activeId],
    queryFn: () => apiFetch<MasterCvDetailDto>(`/cv/${activeId as string}`),
    enabled: activeId !== null,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiFetch<CvUploadResultDto>('/cv/upload', { method: 'POST', body: form });
    },
    onSuccess: async (result) => {
      setLastUpload(result);
      setSelectedId(result.cv.id);
      await queryClient.invalidateQueries({ queryKey: ['cvs'] });
      queryClient.setQueryData(['cv', result.cv.id], result.cv);
      toast.success('CV read. Check the parts we could not find.');
    },
  });

  const setDefault = useMutation({
    mutationFn: (id: string) =>
      apiFetch<MasterCvSummaryDto[]>(`/cv/${id}/set-default`, { method: 'POST' }),
    onSuccess: (rows) => {
      queryClient.setQueryData(['cvs'], rows);
      toast.success('Default CV updated.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/cv/${id}`, { method: 'DELETE' }),
    onSuccess: async (_result, id) => {
      if (activeId === id) setSelectedId(null);
      setLastUpload(null);
      await queryClient.invalidateQueries({ queryKey: ['cvs'] });
      toast.success('CV deleted.');
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<MasterCvDetailDto>('/cv', { method: 'POST', body: { title: 'Untitled CV' } }),
    onSuccess: async (cv) => {
      setLastUpload(null);
      setSelectedId(cv.id);
      await queryClient.invalidateQueries({ queryKey: ['cvs'] });
    },
    onError: (error: unknown) => toast.error(describeError(error)),
  });

  if (listQuery.isError) {
    return <LoadFailure error={listQuery.error} onRetry={() => void listQuery.refetch()} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CVs</h1>
          <p className="text-sm text-muted-foreground">
            Your master CV. Everything else — matching, tailoring, applications — is built from it.
          </p>
        </div>
        <Button variant="outline" onClick={() => create.mutate()} disabled={create.isPending}>
          Start one from scratch
        </Button>
      </header>

      {listQuery.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : cvs.length === 0 ? (
        <div className="flex flex-col gap-4">
          <CvUpload
            isUploading={upload.isPending}
            onUpload={(file) => upload.mutateAsync(file)}
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="flex flex-col gap-4">
            <CvList
              cvs={cvs}
              activeId={activeId}
              onSelect={(id) => {
                setSelectedId(id);
                setLastUpload(null);
              }}
              onSetDefault={(id) => setDefault.mutate(id)}
              onDelete={(id) => remove.mutate(id)}
              isBusy={setDefault.isPending || remove.isPending}
            />
            <CvUpload isUploading={upload.isPending} onUpload={(file) => upload.mutateAsync(file)} />
          </div>

          <div className="min-w-0">
            {activeId === null ? null : detailQuery.isPending ? (
              <Skeleton className="h-96 w-full" />
            ) : detailQuery.isError ? (
              <LoadFailure
                error={detailQuery.error}
                onRetry={() => void detailQuery.refetch()}
              />
            ) : detailQuery.data ? (
              <CvDetailPane
                cv={detailQuery.data}
                templates={templatesQuery.data ?? []}
                uploadReport={lastUpload?.cv.id === detailQuery.data.id ? lastUpload : null}
              />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

interface CvDetailPaneProps {
  readonly cv: MasterCvDetailDto;
  readonly templates: readonly CvTemplateDto[];
  readonly uploadReport: CvUploadResultDto | null;
}

function CvDetailPane({ cv, templates, uploadReport }: CvDetailPaneProps): React.ReactElement {
  const queryClient = useQueryClient();

  // The API returns the document as `unknown`, so it is parsed here rather
  // than cast. A stored CV that fails validation still opens — the editor is
  // where it gets fixed — but it opens as a valid empty document rather than
  // crashing the page on a missing field.
  const parsed = React.useMemo(() => CvDocumentSchema.safeParse(cv.content), [cv.content]);

  const [draft, setDraft] = React.useState<CvDocument | null>(null);
  const [title, setTitle] = React.useState(cv.title);

  /*
   * The draft is replaced only when a DIFFERENT CV is opened.
   *
   * The obvious version of this effect depends on the parsed content, and it
   * silently eats the user's work: every autosave writes the server's response
   * back into the query cache, the content reference changes, the effect runs,
   * and whatever was typed while the request was in flight is overwritten by
   * the version that was sent. Tracking the id is what distinguishes "the user
   * opened another CV" from "our own save came back".
   */
  const loadedId = React.useRef<string | null>(null);

  if (loadedId.current !== cv.id) {
    loadedId.current = cv.id;
    // Rendering-phase state set for a new key: React re-renders immediately
    // with the right document rather than flashing the previous CV's content.
    setDraft(parsed.success ? parsed.data : null);
    setTitle(cv.title);
  }

  const save = React.useCallback(
    async (next: { document: CvDocument; title: string }) => {
      const updated = await apiFetch<MasterCvDetailDto>(`/cv/${cv.id}`, {
        method: 'PATCH',
        body: { content: tidyForSave(next.document), title: next.title },
      });

      queryClient.setQueryData(['cv', cv.id], updated);
      queryClient.setQueryData<MasterCvSummaryDto[]>(['cvs'], (rows) =>
        rows?.map((row) => (row.id === updated.id ? { ...row, ...summaryOf(updated) } : row)),
      );
    },
    [cv.id, queryClient],
  );

  const autosaveValue = React.useMemo(
    () => (draft ? { document: draft, title } : null),
    [draft, title],
  );

  const autosave = useAutosave({
    value: autosaveValue as { document: CvDocument; title: string },
    onSave: save,
    enabled: autosaveValue !== null,
  });

  const [format, setFormat] = React.useState<'pdf' | 'docx'>('pdf');
  const [templateKey, setTemplateKey] = React.useState<string>('modern-ats');
  const [isDownloading, setIsDownloading] = React.useState(false);

  const download = async (): Promise<void> => {
    setIsDownloading(true);
    try {
      // Any pending edit is flushed first, so the file matches what is on
      // screen rather than the last autosave.
      await autosave.saveNow();
      await apiDownload(
        `/cv/${cv.id}/download?format=${format}&template=${encodeURIComponent(templateKey)}`,
        `cv.${format}`,
      );
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setIsDownloading(false);
    }
  };

  const saveMessage = describeSaveState(autosave.state);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base font-medium"
              aria-label="CV name"
            />
          </label>

          <p
            role="status"
            aria-live="polite"
            className={
              autosave.state.status === 'error'
                ? 'text-sm text-destructive'
                : 'text-sm text-muted-foreground'
            }
          >
            {saveMessage}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Template</span>
            <select
              value={templateKey}
              onChange={(event) => setTemplateKey(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Format</span>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value === 'docx' ? 'docx' : 'pdf')}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
            </select>
          </label>

          <Button onClick={() => void download()} disabled={isDownloading || draft === null}>
            {isDownloading ? 'Preparing…' : 'Download'}
          </Button>

          {cv.sourceFile ? (
            <Button
              variant="outline"
              onClick={() =>
                void apiDownload(`/cv/${cv.id}/source`, cv.sourceFile?.originalName ?? 'cv').catch(
                  (error: unknown) => toast.error(describeError(error)),
                )
              }
            >
              Original file
            </Button>
          ) : null}
        </div>
      </div>

      <ParseReport cv={cv} uploadReport={uploadReport} />

      {draft === null ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium">This CV could not be opened in the editor.</p>
          <p className="mt-1 text-muted-foreground">
            Its stored contents do not match the expected shape. Nothing has been lost — download
            the original file, or start a new CV and paste the details across.
          </p>
        </div>
      ) : (
        <CvEditor document={draft} onChange={setDraft} />
      )}
    </div>
  );
}

/** The summary fields a fresh detail response can update in the list. */
function summaryOf(cv: MasterCvDetailDto): Partial<MasterCvSummaryDto> {
  return {
    title: cv.title,
    fullName: cv.fullName,
    headline: cv.headline,
    experienceCount: cv.experienceCount,
    skillCount: cv.skillCount,
    updatedAt: cv.updatedAt,
  };
}

function describeError(error: unknown): string {
  if (error instanceof ConfigurationError || error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

function LoadFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}): React.ReactElement {
  const notDeployed = error instanceof ApiError && error.code === 'NOT_FOUND';

  if (notDeployed) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">CVs are not available yet</h2>
        <p className="text-sm text-muted-foreground">
          This deployment has no CV endpoint connected. Nothing is broken — the feature is not
          switched on here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <div>
        <h2 className="text-lg font-semibold">Could not load your CVs</h2>
        <p className="mt-1 text-sm text-muted-foreground">{describeError(error)}</p>
      </div>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
