import { useTranslation } from '@mc/i18n/react';
import { DAILY_NOTE_MAX } from '@mc/shared/contracts';
import { PublishBar, StepHeader } from '@mc/ui/admin';
import { TextArea } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';

import { useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { DailyLost, EntryText } from '../features/daily/components/DailyParts.tsx';
import { setDailyDraft, useDailyDraft } from '../features/daily/lib/draft-store.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { VoiceField } from '../features/voice/components/VoiceField.tsx';
import { voiceTitleMissing } from '../features/voice/lib/voice.ts';

export const Route = createFileRoute('/daily/note')({
  component: NoteDailyScreen,
});

/** B6 step 2 — Note (07 B6): the chosen entry and the masjid's optional short note (≤ 200 characters). */
function NoteDailyScreen() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const draft = useDailyDraft();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  if (!draft) return <DailyLost />;
  return (
    <Screen title={t('daily.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={2} total={3} label={t('notice.step', { n: 2, total: 3 })} title={t('daily.noteTitle')} />
        <section className="flex flex-col gap-2">
          <h2 className="type-headline text-text">{t('daily.chosen')}</h2>
          <EntryText entry={draft.entry} />
        </section>
        <TextArea
          label={t('daily.note')}
          optional
          hint={t('daily.noteHint')}
          value={draft.note}
          maxLength={DAILY_NOTE_MAX}
          rows={3}
          dir="auto"
          onChange={(event) => {
            setDailyDraft({ ...draft, note: event.target.value });
          }}
        />
        <VoiceField
          masjidId={masjid?.id}
          voice={draft.voice}
          onVoice={(voice) => {
            setDailyDraft({ ...draft, voice });
          }}
          title={{
            value: draft.voiceTitle ?? '',
            onChange: (voiceTitle) => {
              setDailyDraft({ ...draft, voiceTitle });
            },
          }}
        />
        <PublishBar
          actionLabel={t('notice.next')}
          disabled={voiceTitleMissing(draft, true)}
          onAction={() => {
            navigator.push('/daily/preview');
          }}
        />
      </div>
    </Screen>
  );
}
