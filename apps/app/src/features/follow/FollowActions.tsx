// The follow button area shared by the preview sheet and the `/m/:code` landing: Follow / Open / Open My Masjids, plus
// the notes (already following, limit reached) and the success check that hands over to Masjid Detail.
import { useLocale, useTranslation } from '@mc/i18n/react';
import type { MasjidSummary } from '@mc/shared/contracts/public';
import { Button, InfoNote } from '@mc/ui/components';
import { SuccessCheck } from '@mc/ui/motion';

import { MAX_FOLLOWS } from '../../lib/device/store.ts';
import { masjidName } from '../../lib/masjid.ts';
import type { FollowFlow } from './useFollowFlow.ts';

interface Props {
  readonly masjid: MasjidSummary;
  readonly flow: FollowFlow;
  readonly onOpen: (masjidId: string) => void;
}

/** The primary button for the current phase (nothing once followed — the check plays). */
export function FollowActions({ masjid, flow, onOpen, onManage }: Props & { readonly onManage: () => void }) {
  const { t } = useTranslation('follow');
  if (flow.phase === 'followed' || flow.phase === 'opened') return null;
  if (flow.phase === 'limit') {
    return (
      <Button size="lg" fullWidth onPress={onManage}>
        {t('preview.manage')}
      </Button>
    );
  }
  if (flow.already) {
    return (
      <Button
        size="lg"
        fullWidth
        onPress={() => {
          onOpen(masjid.id);
        }}
      >
        {t('preview.open')}
      </Button>
    );
  }
  return (
    <Button size="lg" fullWidth loading={flow.phase === 'busy'} onPress={() => void flow.follow()}>
      {t('preview.follow')}
    </Button>
  );
}

/** Notes under the preview, and the success check (then `flow.complete` opens the masjid). */
export function FollowNotes({ masjid, flow }: Omit<Props, 'onOpen'>) {
  const { t } = useTranslation('follow');
  const { locale } = useLocale();
  if (flow.already) return <InfoNote>{t('preview.already')}</InfoNote>;
  if (flow.phase === 'limit') return <InfoNote>{t('preview.limit', { max: MAX_FOLLOWS })}</InfoNote>;
  if (flow.phase !== 'followed' && flow.phase !== 'opened') return null;
  const done = t('preview.followed', { name: masjidName(masjid, locale) });
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <SuccessCheck title={done} onComplete={flow.complete} />
      <p role="status" className="text-center type-headline text-primary-700">
        {done}
      </p>
    </div>
  );
}
