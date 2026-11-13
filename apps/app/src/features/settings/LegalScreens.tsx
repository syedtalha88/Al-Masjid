// Settings → Privacy Policy (legal reader with the DRAFT badge, 05 §10), Contact & Grievance (the Grievance Officer from
// `/config`, 05 §3 — changes without deploys; the in-app form arrives with Phase 8) and About (07 A15).
import { type LegalDoc, loadLegalDoc } from '@mc/i18n/legal';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, Card, EmptyState, InfoNote, ListRow, Skeleton, SkeletonText, Tag } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { configQuery } from '../../lib/api/queries.ts';
import { useAppData } from '../../lib/data.tsx';
import { appRelease } from '../../lib/query/persist.ts';
import { GrievanceForm } from './GrievanceForm.tsx';

const Gate = ({ children }: { readonly children: ReactNode }) => {
  const { ready } = useTranslation('settings');
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <>{children}</>;
};

export function PrivacyScreen() {
  return (
    <Gate>
      <LegalReader name="privacy" />
    </Gate>
  );
}

export function TermsScreen() {
  return (
    <Gate>
      <LegalReader name="terms" />
    </Gate>
  );
}

export function ContentPolicyScreen() {
  return (
    <Gate>
      <LegalReader name="content-policy" />
    </Gate>
  );
}

const TITLE_KEY = { privacy: 'privacy', terms: 'terms', 'content-policy': 'contentPolicy' } as const;

/** Draft marks for a legal document (05 §10): the DRAFT banner and, for machine translations, DRAFT TRANSLATION. */
export function LegalMarks({ doc }: { readonly doc: LegalDoc }) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex flex-wrap items-center gap-2" data-legal-marks>
      {doc.status === 'draft' ? <Tag tone="danger">{t('draft')}</Tag> : null}
      {doc.draftTranslation ? <Tag tone="sun">{t('draftTranslation')}</Tag> : null}
      <span className="type-caption text-text-tertiary">{t('docVersion', { version: doc.version })}</span>
    </div>
  );
}

/** The legal reader (05 §10, T8.6): the bundled document in the person's language, with its draft marks. */
function LegalReader({ name }: { readonly name: keyof typeof TITLE_KEY }) {
  const { t } = useTranslation('settings');
  const navigator = useNavigator();
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  // Same key as onboarding's sheet: one copy in memory (bundled file, never stale).
  const doc = useQuery({
    queryKey: ['legal', name, locale],
    queryFn: () => loadLegalDoc(name, locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Screen title={t(TITLE_KEY[name])}>
      <article className="flex flex-col gap-4 pt-2 pb-8" data-legal-doc={name}>
        {doc.data ? (
          <>
            <LegalMarks doc={doc.data} />
            <ul dir="auto" className="flex list-disc flex-col gap-3 ps-5 type-body text-text">
              {doc.data.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {/* Questions go to the Grievance Officer; this is also the page's keyboard stop (axe). */}
            <Button
              variant="outline"
              fullWidth
              onPress={() => {
                navigator.push('/settings/grievance');
              }}
            >
              {t('grievance')}
            </Button>
          </>
        ) : doc.isError ? (
          <EmptyState
            title={tc('appError.title')}
            action={
              <Button variant="outline" onPress={() => void doc.refetch()}>
                {tc('appError.retry')}
              </Button>
            }
          />
        ) : (
          <div aria-busy className="flex flex-col gap-3">
            <Skeleton className="h-6 w-40 rounded-xs" />
            <SkeletonText lines={8} />
          </div>
        )}
      </article>
    </Screen>
  );
}

export function GrievanceScreen() {
  return (
    <Gate>
      <Grievance />
    </Gate>
  );
}

function Grievance() {
  const { t } = useTranslation('settings');
  const { api } = useAppData();
  const config = useQuery(configQuery(api));
  const officer = config.data?.grievanceOfficer;
  const { locale } = useLocale();
  const doc = useQuery({
    queryKey: ['legal', 'grievance', locale],
    queryFn: () => loadLegalDoc('grievance', locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  // Placeholders ("NOT SET") until the Super Admin fills them in (C10): no mail link to a non-address.
  const email = officer && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officer.email) ? officer.email : null;
  return (
    <Screen title={t('grievance')}>
      <div className="flex flex-col gap-4 pt-2 pb-8">
        {officer ? (
          <Card className="flex flex-col gap-1">
            <p className="type-caption text-text-secondary">{t('officer')}</p>
            <p className="type-headline text-text">{officer.name}</p>
            <address className="flex flex-col not-italic type-callout text-text">
              {email ? (
                <bdi dir="ltr" className="text-start">
                  {email}
                </bdi>
              ) : null}
              <span>{officer.address}</span>
              <span>{officer.city}</span>
            </address>
            <p className="pt-2 type-footnote text-text-secondary">{t('officerTimes')}</p>
            {email ? (
              <a
                // One address only: anything else in the configured value (`?`, `&`, `,`) is percent-encoded.
                href={`mailto:${encodeURIComponent(email).replace(/%40/g, '@')}`}
                className="mt-3 inline-flex min-h-(--mc-control-md) items-center justify-center rounded-full border-[1.5px] border-primary-700 px-5 type-subhead-strong text-primary-700"
              >
                {t('emailOfficer')}
              </a>
            ) : null}
          </Card>
        ) : config.isError ? (
          <InfoNote>{t('officerOffline')}</InfoNote>
        ) : (
          <div aria-busy className="flex flex-col gap-2">
            <Skeleton className="h-32 w-full rounded-md" />
          </div>
        )}
        {doc.data ? (
          <details className="rounded-md bg-surface p-4 shadow-e1" data-legal-doc="grievance">
            <summary className="min-h-11 cursor-pointer type-headline text-text">{t('grievanceHow')}</summary>
            <div className="flex flex-col gap-3 pt-3">
              <LegalMarks doc={doc.data} />
              <ul dir="auto" className="flex list-disc flex-col gap-2 ps-5 type-callout text-text">
                {doc.data.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}
        <GrievanceForm />
      </div>
    </Screen>
  );
}

export function AboutScreen() {
  return (
    <Gate>
      <About />
    </Gate>
  );
}

function About() {
  const { t } = useTranslation('settings');
  const navigator = useNavigator();
  const release = appRelease();
  return (
    <Screen title={t('about')}>
      <div className="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
        <img src="/icon-192.png" alt="" width={96} height={96} className="size-24 rounded-lg shadow-e1" />
        <h2 className="type-title2 text-text">{BRAND.name}</h2>
        <p className="type-caption text-text-tertiary">
          <bdi>{t('appVersion', { version: release.slice(0, 7) })}</bdi>
        </p>
        <p className="max-w-xs pt-4 type-body text-text">{t('aboutFree')}</p>
        <p className="type-callout text-text-secondary">{t('aboutCommunity')}</p>
      </div>
      <ul className="mb-8 flex flex-col divide-y divide-border rounded-md bg-surface shadow-e1">
        {(
          [
            ['terms', '/settings/terms'],
            ['contentPolicy', '/settings/content-policy'],
            ['licenses', '/settings/licenses'],
          ] as const
        ).map(([key, path]) => (
          <li key={key}>
            <ListRow
              className="px-4"
              title={t(key)}
              chevron
              onPress={() => {
                navigator.push(path);
              }}
            />
          </li>
        ))}
      </ul>
    </Screen>
  );
}
