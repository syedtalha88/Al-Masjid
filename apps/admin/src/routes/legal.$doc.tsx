import { LEGAL_DOC_NAMES, type LegalDocName, loadLegalDoc } from '@mc/i18n/legal';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { licensesFileSchema } from '@mc/shared/contracts';
import { Button, EmptyState, SkeletonText, Tag } from '@mc/ui/components';
import { Screen, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/legal/$doc')({
  component: LegalScreen,
});

type Doc = LegalDocName | 'licenses';
const TITLE_KEY = {
  privacy: 'legal.privacy',
  terms: 'legal.terms',
  'content-policy': 'legal.contentPolicy',
  grievance: 'legal.grievance',
  undertaking: 'legal.undertaking',
  licenses: 'legal.licenses',
} as const satisfies Readonly<Record<Doc, string>>;

const isDoc = (value: string): value is Doc =>
  value === 'licenses' || (LEGAL_DOC_NAMES as readonly string[]).includes(value);

/**
 * Legal reader in the admin app (05 §10, PHASE_08 T8.6): privacy, terms, content policy, grievance, undertaking — the
 * bundled document in the admin's language with its draft marks — and the open-source licenses (`/licenses.json`).
 */
function LegalScreen() {
  const { t } = useTranslation('admin');
  const { params } = useScreen();
  const doc = params['doc'] ?? '';
  if (!isDoc(doc)) {
    return (
      <Screen title={t('legal.title')}>
        <EmptyState className="mt-8" title={t('legal.notFound')} />
      </Screen>
    );
  }
  return <Screen title={t(TITLE_KEY[doc])}>{doc === 'licenses' ? <Licenses /> : <Reader name={doc} />}</Screen>;
}

function Reader({ name }: { readonly name: LegalDocName }) {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const doc = useQuery({
    queryKey: ['legal', name, locale],
    queryFn: () => loadLegalDoc(name, locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (doc.isError) {
    return (
      <EmptyState
        className="mt-8"
        title={tc('appError.title')}
        action={
          <Button variant="outline" size="lg" onPress={() => void doc.refetch()}>
            {tc('appError.retry')}
          </Button>
        }
      />
    );
  }
  if (!doc.data) return <SkeletonText lines={8} />;
  return (
    <article className="flex flex-col gap-4 pb-10" data-legal-doc={name}>
      <div className="flex flex-wrap items-center gap-2">
        {doc.data.status === 'draft' ? <Tag tone="danger">{t('legal.draft')}</Tag> : null}
        {doc.data.draftTranslation ? <Tag tone="sun">{t('legal.draftTranslation')}</Tag> : null}
        <span className="type-caption text-text-tertiary">{t('legal.version', { version: doc.data.version })}</span>
      </div>
      <ul dir="auto" className="flex list-disc flex-col gap-3 ps-5 type-body text-text">
        {doc.data.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </article>
  );
}

function Licenses() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const list = useQuery({
    queryKey: ['licenses'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/licenses.json', { signal });
      if (!response.ok) throw new Error(`licenses: HTTP ${String(response.status)}`);
      return licensesFileSchema.parse(await response.json());
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (list.isError) {
    return (
      <EmptyState
        className="mt-8"
        title={tc('appError.title')}
        action={
          <Button variant="outline" size="lg" onPress={() => void list.refetch()}>
            {tc('appError.retry')}
          </Button>
        }
      />
    );
  }
  if (!list.data) return <SkeletonText lines={10} />;
  return (
    <div className="flex flex-col gap-4 pb-10">
      <p className="type-callout text-text-secondary">{t('legal.licensesLead')}</p>
      <ul className="flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1" data-licenses>
        {list.data.packages.map((entry) => (
          <li key={`${entry.name}@${entry.version}`} className="flex flex-col gap-0.5 px-4 py-3">
            {entry.homepage ? (
              // Each package's own page — also the keyboard stops of this long list (axe).
              <a
                href={entry.homepage}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="self-start type-subhead-strong text-primary-700 underline-offset-2 hover:underline"
              >
                {entry.name}
              </a>
            ) : (
              <bdi dir="ltr" className="type-subhead-strong text-text">
                {entry.name}
              </bdi>
            )}
            <bdi dir="ltr" className="type-footnote text-text-secondary">
              {`${entry.version} · ${entry.license}`}
            </bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}
