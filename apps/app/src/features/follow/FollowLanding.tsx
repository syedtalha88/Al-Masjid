// A16 follow landing (`/m/:code`, 07 A16, DECISIONS #14): the masjid preview and "Follow masjid". In iPhone Safari
// (not the installed app) following here would land in Safari's storage, not the Home Screen app's, so the page
// explains how to follow inside the app — with the follow code shown large for "Enter code" — and offers to go on in
// Safari instead. Unknown code → friendly not-found with "Scan again".
import { formatFollowCode, normalizeFollowCode } from '@mc/domain/follow-code';
import { useTranslation } from '@mc/i18n/react';
import { BRAND } from '@mc/shared/brand';
import { QrPosterIllustration } from '@mc/ui';
import { Button, Card, EmptyState, IosInstallGuide, Skeleton, SkeletonText } from '@mc/ui/components';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useAppData } from '../../lib/data.tsx';
import { isStandalone, platformKind } from '../../lib/platform.ts';
import { FollowActions, FollowNotes } from './FollowActions.tsx';
import { lookupFailure, resolveKey } from './lookup.ts';
import { MasjidPreview } from './MasjidPreview.tsx';
import { useFollowFlow } from './useFollowFlow.ts';

/** iPhone/iPad Safari outside the installed app — where DECISIONS #14's explainer applies. */
export const inIosBrowser = (): boolean => platformKind() === 'ios' && !isStandalone();

export interface FollowLandingProps {
  /** The code from the URL, as typed (normalised here). */
  readonly code: string;
  /** Show the iPhone Safari explainer first (default: detected). */
  readonly iosBrowser?: boolean;
  /** Followed (after the success check), or "Open" on one already followed. */
  readonly onOpen: (masjidId: string) => void;
  readonly onManage: () => void;
  /** "Scan again" on not-found. */
  readonly onScan: () => void;
  /**
   * Before onboarding (the follow happens when it ends): the landing offers only this — `true` from "Follow masjid",
   * `false` from a not-found code.
   */
  readonly onContinue?: (followable: boolean) => void;
}

export function FollowLanding({
  code: raw,
  iosBrowser = inIosBrowser(),
  onOpen,
  onManage,
  onScan,
  onContinue,
}: FollowLandingProps) {
  const { t } = useTranslation('follow');
  const { t: tc } = useTranslation();
  const { t: te } = useTranslation('errors');
  const { api } = useAppData();
  const code = normalizeFollowCode(raw);
  const masjid = useQuery({
    queryKey: resolveKey(code ?? '-'),
    queryFn: ({ signal }) => api.resolve(code ?? '', signal),
    enabled: code !== null,
    retry: false,
    staleTime: 60_000,
  });
  const flow = useFollowFlow(masjid.data?.id ?? null, onOpen);
  const [here, setHere] = useState(!iosBrowser);
  const [guide, setGuide] = useState(true);

  const failure = code === null ? 'not-found' : masjid.isError ? lookupFailure(masjid.error) : null;
  if (failure === 'not-found') {
    return (
      <EmptyState
        className="pt-10"
        illustration={<QrPosterIllustration width={180} />}
        title={t('landing.notFoundTitle')}
        body={t('landing.notFoundBody')}
        action={
          <Button
            size="lg"
            onPress={() => {
              if (onContinue) onContinue(false);
              else onScan();
            }}
          >
            {onContinue ? t('landing.continue') : t('landing.scanAgain')}
          </Button>
        }
      />
    );
  }
  if (failure) {
    return (
      <EmptyState
        className="pt-10"
        title={tc('appError.title')}
        body={failure === 'offline' ? te('NETWORK') : tc('appError.body')}
        action={
          <Button size="lg" onPress={() => void masjid.refetch()}>
            {tc('appError.retry')}
          </Button>
        }
      />
    );
  }
  if (!masjid.data || code === null) {
    return (
      <div aria-busy className="flex flex-col gap-4 pt-2">
        <Skeleton className="aspect-[16/10] w-full rounded-lg" />
        <Skeleton className="h-7 w-2/3 rounded-xs" />
        <SkeletonText lines={1} />
      </div>
    );
  }

  const data = masjid.data;
  return (
    <div className="flex flex-col gap-5 pb-6">
      <MasjidPreview masjid={data} headingLevel={1} />
      {here ? (
        <>
          <FollowNotes masjid={data} flow={flow} />
          {onContinue ? (
            <Button
              size="lg"
              fullWidth
              onPress={() => {
                onContinue(true);
              }}
            >
              {t('preview.follow')}
            </Button>
          ) : (
            <FollowActions masjid={data} flow={flow} onOpen={onOpen} onManage={onManage} />
          )}
        </>
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            <h2 className="type-headline text-text">{t('landing.iosTitle', { app: BRAND.name })}</h2>
            <p className="type-body text-text-secondary">{t('landing.iosBody', { app: BRAND.name })}</p>
            <p className="flex flex-col items-center gap-1 rounded-lg bg-mint-50 py-4">
              <span className="type-caption text-text-secondary">{t('landing.codeLabel')}</span>
              <span dir="ltr" className="type-large-title tracking-widest text-primary-800 tabular-nums">
                {formatFollowCode(code)}
              </span>
            </p>
          </Card>
          {guide ? (
            <>
              <p className="type-callout text-text-secondary">{t('landing.iosNoApp')}</p>
              <IosInstallGuide
                appName={BRAND.name}
                onDismiss={() => {
                  setGuide(false);
                }}
              />
            </>
          ) : null}
          <Button
            variant="ghost"
            fullWidth
            onPress={() => {
              setHere(true);
            }}
          >
            {t('landing.iosHere')}
          </Button>
        </>
      )}
    </div>
  );
}
