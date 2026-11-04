import { addDays, calendarDateInZone } from '@mc/domain/time';
import { duaMessages } from '@mc/i18n/dua-messages';
import { type Locale, LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { DUA_MESSAGE_MAX, DUA_NAME_MAX, JANAZA_PLACE_MAX } from '@mc/shared/contracts';
import { PublishBar, StepHeader } from '@mc/ui/admin';
import {
  Button,
  DatePickerSheet,
  RadioCardGroup,
  SegmentedControl,
  Switch,
  TextArea,
  TextField,
} from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { DuaIssues, DuaLost } from '../features/dua/components/DuaParts.tsx';
import { setDuaDraft, useDuaDraft } from '../features/dua/lib/draft-store.ts';
import { detailIssues, type DuaDraft, withLocale, withMessageKey, withOwnMessage } from '../features/dua/lib/dua.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { SlotButton } from '../features/timings/components/EditorParts.tsx';
import { TimeSheet } from '../features/timings/components/TimingSheets.tsx';
import { ltr } from '../features/timings/lib/text.ts';

export const Route = createFileRoute('/dua/details')({
  component: DetailsDuaScreen,
});

/** A janaza is announced up to 30 days ahead (the server's window — 03 §4 `POST /items/dua`). */
const JANAZA_AHEAD_DAYS = 30;

/**
 * B7 step 2 — Details (07 B7): the language, a ready-made message (or the admin's own text), the person's name with
 * "Keep name private" on by default and the consent hint, and for an inteqal the janaza date, time and place. "Next"
 * shows what is still missing instead of going on.
 */
function DetailsDuaScreen() {
  const draft = useDuaDraft();
  if (!draft) return <DuaLost />;
  return <DetailsForm draft={draft} />;
}

function DetailsForm({ draft }: { readonly draft: DuaDraft }) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const navigator = useNavigator();
  const today = calendarDateInZone(useMinute());
  // Each refused "Next" brings the list of what is missing into view (it sits above the bar, often off screen).
  const [tried, setTried] = useState(0);
  const issueList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tried > 0) issueList.current?.scrollIntoView({ block: 'center' });
  }, [tried]);
  const [picking, setPicking] = useState<'janazaDate' | 'janazaTime' | null>(null);
  const issues = detailIssues(draft);
  const update = (next: DuaDraft) => {
    setDuaDraft(next);
  };

  return (
    <Screen title={t('dua.title')}>
      <div className="flex flex-col gap-6">
        <StepHeader step={2} total={4} label={t('notice.step', { n: 2, total: 4 })} title={t('dua.detailsTitle')} />

        <SegmentedControl<Locale>
          label={t('notice.language')}
          segments={LOCALES.map((id) => ({ id, label: NATIVE_NAME[id] }))}
          value={draft.locale}
          onChange={(locale) => {
            update(withLocale(draft, locale));
          }}
        />
        <RadioCardGroup<string>
          legend={t('dua.messages')}
          name="dua-message"
          options={duaMessages(draft.category, draft.locale).map((message) => ({
            value: message.key,
            title: message.text,
            lang: draft.locale,
          }))}
          value={draft.messageKey}
          onChange={(key) => {
            update(withMessageKey(draft, key));
          }}
        />
        <TextArea
          label={t('dua.message')}
          value={draft.message}
          maxLength={DUA_MESSAGE_MAX}
          rows={4}
          dir="auto"
          lang={draft.locale}
          onChange={(event) => {
            update(withOwnMessage(draft, event.target.value));
          }}
        />

        <div className="flex flex-col gap-3">
          <TextField
            label={t('dua.name')}
            optional
            hint={t('dua.nameHint')}
            value={draft.personName}
            maxLength={DUA_NAME_MAX}
            dir="auto"
            autoComplete="off"
            onChange={(event) => {
              update({ ...draft, personName: event.target.value });
            }}
          />
          <Switch
            checked={draft.namePrivate}
            onChange={(namePrivate) => {
              update({ ...draft, namePrivate });
            }}
            label={t('dua.private')}
            description={t('dua.privateHint')}
          />
        </div>

        {draft.category === 'inteqal' ? (
          <section className="flex flex-col gap-3" data-janaza>
            <div className="flex flex-col gap-1">
              <h2 className="type-headline text-text">{t('dua.janaza')}</h2>
              <p className="type-footnote text-text-secondary">{t('dua.janazaOptional')}</p>
            </div>
            <div className="flex gap-3">
              <SlotButton
                label={t('dua.janazaDate')}
                value={draft.janazaDate === null ? t('notice.notSet') : format.calendarDate(draft.janazaDate, 'long')}
                onPress={() => {
                  setPicking('janazaDate');
                }}
              />
              <SlotButton
                label={t('dua.janazaTime')}
                value={draft.janazaTime === null ? t('notice.notSet') : ltr(format.time(draft.janazaTime).text)}
                onPress={() => {
                  setPicking('janazaTime');
                }}
              />
            </div>
            <TextField
              label={t('dua.janazaPlace')}
              optional
              value={draft.janazaPlace}
              maxLength={JANAZA_PLACE_MAX}
              dir="auto"
              onChange={(event) => {
                update({ ...draft, janazaPlace: event.target.value });
              }}
            />
            {draft.janazaDate !== null || draft.janazaTime !== null ? (
              <Button
                variant="ghost"
                onPress={() => {
                  update({ ...draft, janazaDate: null, janazaTime: null });
                }}
              >
                {t('dua.janazaClear')}
              </Button>
            ) : null}
          </section>
        ) : null}

        <div ref={issueList}>{tried > 0 ? <DuaIssues issues={issues} /> : null}</div>

        <PublishBar
          actionLabel={t('dua.next')}
          onAction={() => {
            if (issues.length > 0) {
              setTried((count) => count + 1);
              return;
            }
            navigator.push('/dua/attach');
          }}
        />
      </div>

      <DatePickerSheet
        open={picking === 'janazaDate'}
        onClose={() => {
          // A day tap calls onChange (which may open the time sheet next) and then onClose: keep that next sheet.
          setPicking((current) => (current === 'janazaDate' ? null : current));
        }}
        title={t('dua.janazaDate')}
        value={draft.janazaDate}
        min={today}
        max={addDays(today, JANAZA_AHEAD_DAYS)}
        today={today}
        onChange={(janazaDate) => {
          update({ ...draft, janazaDate });
          setPicking(draft.janazaTime === null ? 'janazaTime' : null);
        }}
      />
      {picking === 'janazaTime' ? (
        <TimeSheet
          open
          title={t('dua.janazaTime')}
          value={draft.janazaTime ?? '17:00'}
          onClose={() => {
            setPicking(null);
          }}
          onDone={(janazaTime) => {
            update({ ...draft, janazaTime });
            setPicking(null);
          }}
        />
      ) : null}
    </Screen>
  );
}
