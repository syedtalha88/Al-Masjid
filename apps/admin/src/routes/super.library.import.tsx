import { Bdi, useTranslation } from '@mc/i18n/react';
import type { LibraryImportReport } from '@mc/shared/contracts';
import { Button, Card, InfoNote, SectionHeader, SkeletonText, useToast } from '@mc/ui/components';
import { CheckCircleIcon, WarningIcon } from '@mc/ui/icons';
import { useNavigator } from '@mc/ui/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';

import { StepUpCancelled, useStepUp } from '../features/auth/components/StepUpProvider.tsx';
import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/library/import')({
  component: LibraryImport,
});

/**
 * C8 import (DECISIONS #108): choose a file → dry-run report (row problems, duplicates) → ★ import as draft, all or
 * nothing. The file stays on the phone until a button sends it; nothing is saved by the check.
 */
function LibraryImport() {
  const { t } = useTranslation('super');
  return (
    <SuperFrame title={t('library.importTitle')} section="library">
      <ImportBody />
    </SuperFrame>
  );
}

/** Inside the frame: `useStepUp` needs the frame's StepUpProvider. */
function ImportBody() {
  const { t } = useTranslation('super');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const run = useStepUp();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<LibraryImportReport | null>(null);
  const fail = (error: unknown) => {
    if (!(error instanceof StepUpCancelled)) toast.show({ message: errorText(error), tone: 'error' });
  };

  const check = useMutation({
    mutationFn: (chosen: File) => superApi.libraryDryRun(chosen, chosen.name),
    onSuccess: setReport,
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (chosen: File) => run(() => superApi.libraryImport(chosen, chosen.name)),
    onSuccess: async (result) => {
      setReport(result);
      if (result.imported > 0) {
        toast.show({ message: t('library.imported', { count: result.imported }), tone: 'success' });
        await queryClient.invalidateQueries({ queryKey: ['super', 'library'] });
      }
    },
    onError: fail,
  });

  const clean = report !== null && report.errors.length === 0 && report.duplicates.length === 0;
  const done = report !== null && report.imported > 0;

  return (
    <div className="flex flex-col gap-6">
      <InfoNote>{t('library.importIntro')}</InfoNote>
      <label htmlFor={inputId} className="sr-only">
        {t('library.fileLabel')}
      </label>
      <input
        ref={input}
        id={inputId}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const chosen = event.target.files?.[0] ?? null;
          event.target.value = '';
          setFile(chosen);
          setReport(null);
          if (chosen) check.mutate(chosen);
        }}
      />
      {/* A new element per state (key): the style swap must not animate colors mid-check (axe contrast). */}
      <Button
        key={file ? 'other' : 'choose'}
        size="lg"
        variant={file ? 'outline' : 'primary'}
        onPress={() => {
          input.current?.click();
        }}
      >
        {file ? t('library.otherFile') : t('library.chooseFile')}
      </Button>
      {file ? (
        <p className="type-subhead text-text-secondary">
          <Bdi>{file.name}</Bdi>
        </p>
      ) : null}

      {check.isPending ? (
        <div aria-live="polite" className="flex flex-col gap-2">
          <p className="type-body text-text-secondary">{t('library.checking')}</p>
          <SkeletonText lines={4} />
        </div>
      ) : null}

      {report ? <Report report={report} /> : null}

      {report && file && !done ? (
        clean ? (
          <Button
            size="lg"
            fullWidth
            loading={save.isPending}
            onPress={() => {
              save.mutate(file);
            }}
          >
            {t('library.importAll', { count: report.valid })}
          </Button>
        ) : (
          <InfoNote icon={<WarningIcon />}>{t('library.fixFirst')}</InfoNote>
        )
      ) : null}

      {done ? (
        <Button
          size="lg"
          fullWidth
          onPress={() => {
            navigator.back();
          }}
        >
          {t('library.reviewDrafts')}
        </Button>
      ) : null}
    </div>
  );
}

/** The dry-run / import report: counts, then every row problem and duplicate (the first 200 of each). */
function Report({ report }: { readonly report: LibraryImportReport }) {
  const { t } = useTranslation('super');
  const ok = report.errors.length === 0 && report.duplicates.length === 0;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {ok ? <CheckCircleIcon className="text-primary-700" /> : <WarningIcon className="text-danger" />}
        <p className="type-headline text-text">
          {t('library.ready', { valid: report.valid, entries: report.entries })}
        </p>
      </div>
      {report.errors.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionHeader title={t('library.problems', { count: report.errors.length })} />
          <ul className="flex flex-col gap-1">
            {report.errors.map((error) => (
              <li key={`${String(error.row)}-${error.path}-${error.message}`} className="type-subhead text-text">
                <Bdi>
                  {t('library.problemRow', { row: error.row, field: error.path || '—', message: error.message })}
                </Bdi>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.duplicates.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionHeader title={t('library.duplicates', { count: report.duplicates.length })} />
          <ul className="flex flex-col gap-1">
            {report.duplicates.map((duplicate) => (
              <li key={`${String(duplicate.row)}-${duplicate.reference}`} className="type-subhead text-text">
                {t('library.duplicateRow', {
                  row: duplicate.row,
                  reference: duplicate.reference,
                  where: duplicate.in === 'file' ? t('library.inFile') : t('library.inLibrary'),
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.truncated ? <p className="type-caption text-text-tertiary">{t('library.truncated')}</p> : null}
    </Card>
  );
}
