import { NATIVE_NAME } from '@mc/i18n/locales';
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';
import type { SuperLibraryEntry } from '@mc/shared/contracts';
import {
  ArabicText,
  Button,
  Card,
  Dialog,
  EmptyState,
  InfoNote,
  SectionHeader,
  Sheet,
  SkeletonText,
  Tag,
  TextField,
  useToast,
} from '@mc/ui/components';
import { useScreen } from '@mc/ui/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { useErrorText } from '../features/auth/hooks/use-session.ts';
import { superApi } from '../features/super/api/super-api.ts';
import { LibraryStatusTag } from '../features/super/components/LibraryStatusTag.tsx';
import { SuperFrame } from '../features/super/components/SuperFrame.tsx';

export const Route = createFileRoute('/super/library/$id')({
  component: LibraryEntryPage,
});

const LANGUAGES = ['en', 'hi', 'ur', 'te'] as const;

/** C8 review: the Arabic as musallis will see it (Amiri), every translation and transliteration, attribution; Verify / Retire. */
function LibraryEntryPage() {
  const { t } = useTranslation('super');
  const { params } = useScreen();
  const entryId = params['id'] ?? '';
  const errorText = useErrorText();
  const detail = useQuery({
    queryKey: ['super', 'library', 'entry', entryId],
    queryFn: ({ signal }) => superApi.libraryEntry(entryId, signal),
  });
  return (
    <SuperFrame title={detail.data?.entry.reference ?? t('nav.library')} section="library">
      {detail.data ? (
        <Body entry={detail.data.entry} />
      ) : detail.isError ? (
        <EmptyState title={errorText(detail.error)} className="mt-8" />
      ) : (
        <SkeletonText lines={10} />
      )}
    </SuperFrame>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="type-caption text-text-tertiary">{label}</dt>
      <dd className="type-body text-text">{children}</dd>
    </div>
  );
}

/** One text per language, in its own language and direction; missing ones say so. */
function PerLanguage({
  title,
  texts,
}: {
  readonly title: string;
  readonly texts: Readonly<Partial<Record<(typeof LANGUAGES)[number], string | undefined>>>;
}) {
  const { t } = useTranslation('super');
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title={title} />
      <Card className="flex flex-col gap-4">
        {LANGUAGES.map((language) => {
          const text = texts[language];
          return (
            <div key={language} className="flex flex-col gap-1">
              <p className="type-caption text-text-tertiary">{NATIVE_NAME[language]}</p>
              {text ? (
                <p lang={language} dir="auto" className="type-body whitespace-pre-line text-text">
                  {text}
                </p>
              ) : (
                <p className="type-body text-text-tertiary">{t('library.missing')}</p>
              )}
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function Body({ entry }: { readonly entry: SuperLibraryEntry }) {
  const { t } = useTranslation('super');
  const { format } = useLocale();
  const toast = useToast();
  const errorText = useErrorText();
  const queryClient = useQueryClient();
  const [verifying, setVerifying] = useState(false);
  const [verifier, setVerifier] = useState('');
  const [retiring, setRetiring] = useState(false);

  const changed = async (message: string) => {
    toast.show({ message, tone: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['super', 'library'] });
  };
  const fail = (error: unknown) => {
    toast.show({ message: errorText(error), tone: 'error' });
  };
  const verify = useMutation({
    mutationFn: () => superApi.verifyLibraryEntry(entry.id, verifier.trim()),
    onSuccess: async () => {
      setVerifying(false);
      await changed(t('library.verified'));
    },
    onError: fail,
  });
  const retire = useMutation({
    mutationFn: () => superApi.retireLibraryEntry(entry.id),
    onSuccess: async () => {
      setRetiring(false);
      await changed(t('library.retired'));
    },
    onError: fail,
  });

  const occasions = entry.occasions ?? [];
  return (
    <div className="flex flex-col gap-8">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="neutral">{t(`library.kinds.${entry.kind}`)}</Tag>
          <LibraryStatusTag status={entry.status} />
          {entry.duaCategory ? <Tag tone="neutral">{t(`library.categories.${entry.duaCategory}`)}</Tag> : null}
        </div>
        <ArabicText variant="hero">{entry.arabic}</ArabicText>
        {entry.repeat === undefined ? null : (
          <p className="type-subhead text-text-secondary">{t('library.repeat', { count: entry.repeat })}</p>
        )}
        {occasions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {occasions.map((occasion) => (
              <Tag key={occasion} tone="primary">
                {t(`library.occasions.${occasion}`)}
              </Tag>
            ))}
          </div>
        ) : null}
        {entry.verifiedBy && entry.verifiedAt ? (
          <p className="type-subhead text-text-secondary">
            {t('library.verifiedBy', {
              name: entry.verifiedBy,
              date: format.date(new Date(entry.verifiedAt), 'medium'),
            })}
          </p>
        ) : null}
      </Card>

      <PerLanguage title={t('library.translations')} texts={entry.translation} />
      <PerLanguage title={t('library.transliterations')} texts={entry.transliteration} />

      <section className="flex flex-col gap-2">
        <SectionHeader title={t('library.source')} />
        <Card>
          <dl className="flex flex-col gap-3">
            <Fact label={t('library.reference')}>
              <Bdi>{entry.reference}</Bdi>
            </Fact>
            <Fact label={t('library.source')}>
              <span dir="auto">{entry.sourceName}</span>
            </Fact>
            <Fact label={t('library.license')}>
              <span dir="auto">{entry.sourceLicense}</span>
            </Fact>
            {entry.tags.length > 0 ? (
              <Fact label={t('library.tags')}>
                <span className="flex flex-wrap gap-2">
                  {entry.tags.map((tag) => (
                    <Tag key={tag} tone="neutral">
                      {tag}
                    </Tag>
                  ))}
                </span>
              </Fact>
            ) : null}
          </dl>
        </Card>
      </section>

      {entry.status === 'retired' ? null : (
        <div className="flex flex-col gap-3">
          {entry.status === 'draft' ? (
            <Button
              size="lg"
              fullWidth
              onPress={() => {
                setVerifying(true);
              }}
            >
              {t('library.verify')}
            </Button>
          ) : null}
          <Button
            size="lg"
            fullWidth
            variant="outline"
            onPress={() => {
              setRetiring(true);
            }}
          >
            {t('library.retire')}
          </Button>
        </div>
      )}

      <Sheet
        open={verifying}
        onClose={() => {
          setVerifying(false);
        }}
        title={t('library.verifyTitle')}
        footer={
          <Button
            size="lg"
            fullWidth
            disabled={verifier.trim().length < 2}
            loading={verify.isPending}
            onPress={() => {
              verify.mutate();
            }}
          >
            {t('library.verify')}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 pb-4">
          <InfoNote>{t('library.verifyHint')}</InfoNote>
          <TextField
            label={t('library.verifier')}
            value={verifier}
            maxLength={120}
            autoComplete="name"
            onChange={(event) => {
              setVerifier(event.target.value);
            }}
          />
        </div>
      </Sheet>
      <Dialog
        open={retiring}
        onClose={() => {
          setRetiring(false);
        }}
        title={t('library.retireTitle')}
        body={t('library.retireBody')}
        confirmLabel={t('library.retire')}
        destructive
        loading={retire.isPending}
        onConfirm={() => {
          retire.mutate();
        }}
      />
    </div>
  );
}
