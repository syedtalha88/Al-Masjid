// Settings → Privacy Policy (legal reader with the DRAFT badge, 05 §10), Contact & Grievance (the Grievance Officer from
// `/config`, 05 §3 — changes without deploys; the in-app form arrives with Phase 8) and About (07 A15).
import { loadLegalDoc } from '@mc/i18n/legal';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { Button, Card, EmptyState, InfoNote, Skeleton, SkeletonText, Tag } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { configQuery } from '../../lib/api/queries.ts';
import { useAppData } from '../../lib/data.tsx';
import { appRelease } from '../../lib/query/persist.ts';

const Gate = ({ children }: { readonly children: ReactNode }) => {
  const { ready } = useTranslation('settings');
  if (!ready) return <div aria-busy className="h-full bg-bg" />;
  return <>{children}</>;
};

export function PrivacyScreen() {
  return (
    <Gate>
      <Privacy />
    </Gate>
  );
}

function Privacy() {
  const { t } = useTranslation('settings');
  const navigator = useNavigator();
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  // Same key as onboarding's sheet: one copy in memory (bundled file, never stale).
  const doc = useQuery({
    queryKey: ['legal', 'privacy', locale],
    queryFn: () => loadLegalDoc('privacy', locale),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <Screen title={t('privacy')}>
      <article className="flex flex-col gap-4 pt-2 pb-8">
        {doc.data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {doc.data.status === 'draft' ? <Tag tone="danger">{t('draft')}</Tag> : null}
              <span className="type-caption text-text-tertiary">{t('docVersion', { version: doc.data.version })}</span>
            </div>
            {/* The drafts exist in English only so far (human translations come with the legal review). */}
            <ul
              lang={locale !== 'en' ? 'en' : undefined}
              dir="auto"
              className="flex list-disc flex-col gap-3 ps-5 type-body text-text"
            >
              {doc.data.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            {/* The notice sends questions to the Grievance Officer; this is also the page's keyboard stop (axe). */}
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
        <InfoNote>{t('formSoon')}</InfoNote>
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
    </Screen>
  );
}
