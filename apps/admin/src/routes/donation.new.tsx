import { calendarDateInZone } from '@mc/domain/time';
import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import {
  CAMPAIGN_DESCRIPTION_MAX,
  CAMPAIGN_PURPOSES,
  CAMPAIGN_TITLE_MAX,
  type CampaignPurpose,
} from '@mc/shared/contracts';
import { PublishBar } from '@mc/ui/admin';
import {
  Button,
  DatePickerSheet,
  NumberPad,
  ProgressBar,
  RadioCardGroup,
  Switch,
  TextArea,
  TextField,
  useToast,
} from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useCampaignWrites } from '../features/campaign/hooks/use-campaigns.ts';
import { campaignBody, type CampaignDraft, campaignIssues, emptyCampaign } from '../features/campaign/lib/campaign.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { PhotoField } from '../features/notice/components/NoticeParts.tsx';
import { SlotButton } from '../features/timings/components/EditorParts.tsx';

export const Route = createFileRoute('/donation/new')({
  component: NewDriveScreen,
});

/**
 * B8 create flow (07 B8, 00 §4.3, PHASE_05 T5.3): what it is for (5 cards) → title (two suggestions per purpose) and
 * description → target on the NumberPad (≥ ₹1,000) and dates → optional cover photo with the ownership tick → preview
 * → Publish (with "Notify followers"). The server refuses it without active UPI details (the list screen says so first).
 */
function NewDriveScreen() {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const format = formatters(locale);
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const { create } = useCampaignWrites(masjid?.id);
  const today = calendarDateInZone(new Date());
  const [draft, setDraft] = useState<CampaignDraft>(() => emptyCampaign(today));
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const set = (patch: Partial<CampaignDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const issues = campaignIssues(draft);
  const body = campaignBody(draft);
  const started = draft.purpose !== null || draft.title.trim() !== '';
  const suggestions = draft.purpose
    ? (['a', 'b'] as const).map((key) => t(`donation.suggest.${draft.purpose ?? 'other'}.${key}`))
    : [];

  return (
    <Screen title={t('donation.newTitle')}>
      <div className="flex flex-col gap-6 pb-6" data-drive-editor>
        <RadioCardGroup<CampaignPurpose>
          legend={t('donation.purposeQuestion')}
          name="drive-purpose"
          options={CAMPAIGN_PURPOSES.map((purpose) => ({ value: purpose, title: t(`donation.purpose.${purpose}`) }))}
          value={draft.purpose}
          onChange={(purpose) => {
            set({ purpose });
          }}
        />
        <TextField
          label={t('donation.titleLabel')}
          dir="auto"
          maxLength={CAMPAIGN_TITLE_MAX}
          value={draft.title}
          onChange={(event) => {
            set({ title: event.target.value });
          }}
        />
        {suggestions.length > 0 ? (
          <div className="flex flex-col gap-2" data-drive-suggestions>
            <p className="type-footnote text-text-secondary">{t('donation.suggestions')}</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((text) => (
                <Button
                  key={text}
                  variant="outline"
                  size="md"
                  onPress={() => {
                    set({ title: text });
                  }}
                >
                  {text}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <TextArea
          label={t('donation.description')}
          optional
          dir="auto"
          maxLength={CAMPAIGN_DESCRIPTION_MAX}
          value={draft.description}
          onChange={(event) => {
            set({ description: event.target.value });
          }}
        />
        <section className="flex flex-col gap-3" aria-labelledby="drive-target">
          <h2 id="drive-target" className="type-headline text-text">
            {t('donation.target')}
          </h2>
          <p className="type-title-2 text-center text-text" aria-live="polite">
            {format.money(draft.targetPaise)}
          </p>
          <p className="type-footnote text-center text-text-secondary">{t('donation.targetHint')}</p>
          <NumberPad
            value={draft.targetPaise}
            onChange={(targetPaise) => {
              set({ targetPaise });
            }}
            label={t('donation.target')}
          />
        </section>
        <div className="flex flex-wrap gap-3">
          <SlotButton
            label={t('donation.startsOn')}
            value={format.calendarDate(draft.startsOn, 'medium')}
            onPress={() => {
              setPicking('start');
            }}
          />
          <SlotButton
            label={t('donation.endsOn')}
            value={draft.endsOn === '' ? '—' : format.calendarDate(draft.endsOn, 'medium')}
            onPress={() => {
              setPicking('end');
            }}
          />
        </div>
        <PhotoField
          masjidId={masjid?.id}
          purpose="campaign"
          photo={draft.cover}
          onPhoto={(cover) => {
            set({ cover });
          }}
        />
        {body ? (
          <section className="flex flex-col gap-2" aria-labelledby="drive-preview">
            <h2 id="drive-preview" className="type-headline text-text">
              {t('donation.preview')}
            </h2>
            <div className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
              <h3 className="type-headline text-text" dir="auto">
                {body.title}
              </h3>
              <ProgressBar value={0} label={t('donation.receivedLabel')} valueText="0%" />
              <p className="type-body text-text">
                {t('donation.amounts', { received: format.money(0), target: format.money(body.targetPaise) })}
              </p>
            </div>
          </section>
        ) : null}
        <Switch
          checked={draft.notify}
          onChange={(notify) => {
            set({ notify });
          }}
          label={t('donation.notify')}
        />
        {issues.length > 0 && started ? (
          <p className="type-footnote text-text-secondary" aria-live="polite" data-drive-missing>
            {t('donation.missing', { fields: issues.map((issue) => t(`donation.issue.${issue}`)).join(', ') })}
          </p>
        ) : null}
        <PublishBar
          actionLabel={t('donation.publish')}
          disabled={body === null}
          busy={create.isPending}
          onAction={() => {
            if (!body) return;
            create.mutate(body, {
              onSuccess: () => {
                toast.show({ message: t('donation.published'), tone: 'success' });
                navigator.back();
              },
              onError: (error) => {
                toast.show({ message: errorText(error), tone: 'error' });
              },
            });
          }}
        />
      </div>
      <DatePickerSheet
        open={picking !== null}
        onClose={() => {
          setPicking(null);
        }}
        title={t(picking === 'end' ? 'donation.endsOn' : 'donation.startsOn')}
        value={picking === 'end' ? draft.endsOn || null : draft.startsOn}
        min={picking === 'end' ? draft.startsOn : today}
        today={today}
        onChange={(value) => {
          if (picking === 'end') set({ endsOn: value });
          else set({ startsOn: value, ...(draft.endsOn !== '' && draft.endsOn < value ? { endsOn: '' } : {}) });
          setPicking(null);
        }}
      />
    </Screen>
  );
}
