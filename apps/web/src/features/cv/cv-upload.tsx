'use client';

import { CV_UPLOAD_MESSAGES, MAX_CV_UPLOAD_BYTES, type CvUploadResultDto } from '@jobpilot/shared';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const ACCEPT = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface CvUploadProps {
  readonly onUpload: (file: File) => Promise<CvUploadResultDto>;
  readonly isUploading: boolean;
}

/**
 * The upload area.
 *
 * Obvious size and type problems are caught here so the user is told
 * immediately rather than after waiting for a 10 MB round trip. The server
 * repeats every one of these checks — this is a courtesy, not a control, and
 * the file type it reports is only what the browser claims.
 */
export function CvUpload({ onUpload, isUploading }: CvUploadProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handle = React.useCallback(
    async (file: File | undefined) => {
      setError(null);
      if (!file) {
        setError(CV_UPLOAD_MESSAGES.noFile);
        return;
      }
      if (file.size > MAX_CV_UPLOAD_BYTES) {
        setError(CV_UPLOAD_MESSAGES.tooLarge);
        return;
      }
      if (!/\.(pdf|docx)$/i.test(file.name)) {
        setError(CV_UPLOAD_MESSAGES.wrongType);
        return;
      }

      try {
        await onUpload(file);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'That upload failed.');
      } finally {
        // Cleared so choosing the same file again still fires a change event.
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onUpload],
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void handle(event.dataTransfer.files[0]);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center transition-colors',
          isDragging && 'border-primary bg-primary/5',
          isUploading && 'opacity-60',
        )}
      >
        <div>
          <p className="text-sm font-medium">Drop your CV here</p>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF or DOCX, up to {Math.round(MAX_CV_UPLOAD_BYTES / 1024 / 1024)} MB. We read the text
            out of it — nothing is sent to an AI model at this stage.
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? 'Reading your CV…' : 'Choose a file'}
        </Button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          aria-label="Upload a CV"
          onChange={(event) => void handle(event.target.files?.[0])}
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
