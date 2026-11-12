import { calendarDateInZone } from '@mc/domain/time';
import { formatters } from '@mc/i18n/format';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { CHANDA_NOTE_MAX } from '@mc/shared/contracts';
import {
  Button,
  EmptyState,
  IconButton,
  InfoNote,
  NumberPad,
  SegmentedControl,
  SkeletonText,
  Switch,
  TextField,
  useToast,
} from '@mc/ui/components';
import { CaretLeftIcon, CaretRightIcon } from '@mc/ui/icons';
import { Pressable } from '@mc/ui/motion';
import { Screen } from '@mc/ui/navigation';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { useChanda, useChandaWrites } from '../features/chanda/hooks/use-chanda.ts';
import {
  CHANDA_WEEK_STARTS,
  chandaBody,
  type ChandaDraft,
  chandaWeekChoices,
  draftFor,
  isSaved,
  weekRange,
} from '../features/chanda/lib/chanda.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';

/** The B9 week-start choices' labels (typed keys). */
const DAY_KEY = { 5: 'chanda.day.5', 1: 'chanda.day.1' } as const;

export const Route = createFileRoute('/chanda')({
  component: ChandaScreen,
});

/**
 * B9 Chanda (07 B9, 00 §4.3, PHASE_05 T5.5): "Show chanda to followers" (the masjid's choice, off by default — with
 * what it means), the day the week starts (Friday / Monday), a week stepper (this week by default), the total on the
 * NumberPad, an optional note, "Notify followers" (off by default; only while shown), Save, and the earlier weeks — a
 * tap opens one to correct it.
 */
function ChandaScreen() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const { locale } = useLocale();
  const format = formatters(locale);
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid } = useSelectedMasjid(me.masjids);
  const chanda = useChanda(masjid?.id);
  const { save, settings } = useChandaWrites(masjid?.id);
  const today = calendarDateInZone(new Date());
  const weekStartDay = chanda.data?.weekStart ?? 5;
  const weeks = chandaWeekChoices(today, weekStartDay);
  const [index, setIndex] = useState(0);
  const week = weeks[Math.min(index, weeks.length - 1)] ?? weeks[0] ?? today;
  // The draft follows the selected week until the admin types: keyed by week (and the loaded data).
  const [edits, setEdits] = useState<{ readonly week: string; readonly draft: ChandaDraft } | null>(null);
  const draft = edits?.week === week ? edits.draft : draftFor(chanda.data, week);
  const [notify, setNotify] = useState(false);
  const shown = chanda.data?.show ?? false;
  const range = weekRange(week);
  const rangeText = t('chanda.range', {
    start: format.calendarDate(range.start, 'medium'),
    end: format.calendarDate(range.end, 'medium'),
  });
  const setDraft = (next: Partial<ChandaDraft>) => {
    setEdits({ week, draft: { ...draft, ...next } });
  };
  const pick = (next: number) => {
    setIndex(next);
    setEdits(null);
    setNotify(false);
  };
  const changeSettings = (body: { show?: boolean; weekStart?: number }, done: string) => {
    settings.mutate(body, {
      onSuccess: () => {
        toast.show({ message: done, tone: 'success' });
        if (body.weekStart !== undefined) pick(0);
        if (body.show === false) setNotify(false);
      },
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };

  if (chanda.isError) {
    return (
      <Screen title={t('chanda.title')}>
        <EmptyState
          className="mt-8"
          title={errorText(chanda.error)}
          action={
            <Button
              size="lg"
              onPress={() => {
                void chanda.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
        />
      </Screen>
    );
  }
  if (!chanda.data) {
    return (
      <Screen title={t('chanda.title')}>
        <div aria-busy>
          <SkeletonText lines={8} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen title={t('chanda.title')}>
      <div className="flex flex-col gap-5 pb-6" data-chanda>
        <p className="type-callout text-text-secondary">{t('chanda.intro')}</p>
        <div className="flex flex-col gap-3 rounded-md bg-surface p-4 shadow-e1">
          <Switch
            checked={shown}
            disabled={settings.isPending}
            onChange={(show) => {
              changeSettings({ show }, t(show ? 'chanda.shownToast' : 'chanda.hiddenToast'));
            }}
            label={t('chanda.show')}
            description={t('chanda.showHint')}
          />
          <SegmentedControl
            label={t('chanda.weekStartsOn')}
            segments={CHANDA_WEEK_STARTS.map((day) => ({ id: String(day), label: t(DAY_KEY[day]) }))}
            value={String(weekStartDay)}
            onChange={(id) => {
              changeSettings({ weekStart: Number(id) }, t('chanda.weekStartSaved'));
            }}
          />
        </div>

        <section className="flex flex-col gap-4" aria-labelledby="chanda-week">
          <div className="flex items-center justify-between gap-2">
            <IconButton
              label={t('chanda.previous')}
              icon={<CaretLeftIcon className="rtl:-scale-x-100" />}
              disabled={index >= weeks.length - 1}
              onPress={() => {
                pick(index + 1);
              }}
            />
            <div className="flex min-w-0 flex-col items-center text-center">
              <h2 id="chanda-week" className="type-headline text-text" data-chanda-week={week}>
                {index === 0 ? t('chanda.thisWeek') : t('chanda.week')}
              </h2>
              <p className="type-footnote text-text-secondary">{rangeText}</p>
            </div>
            <IconButton
              label={t('chanda.next')}
              icon={<CaretRightIcon className="rtl:-scale-x-100" />}
              disabled={index === 0}
              onPress={() => {
                pick(index - 1);
              }}
            />
          </div>
          <NumberPad
            value={draft.amountPaise}
            onChange={(amountPaise) => {
              setDraft({ amountPaise });
            }}
            label={t('chanda.amount')}
          />
          <TextField
            label={t('chanda.note')}
            optional
            hint={t('chanda.noteHint')}
            maxLength={CHANDA_NOTE_MAX}
            value={draft.note}
            onChange={(event) => {
              setDraft({ note: event.target.value });
            }}
          />
          <Switch
            checked={notify && shown}
            disabled={!shown}
            onChange={setNotify}
            label={t('chanda.notify')}
            description={shown ? t('chanda.notifyHint') : t('chanda.notifyHidden')}
          />
          <Button
            size="lg"
            fullWidth
            loading={save.isPending}
            onPress={() => {
              save.mutate(
                { weekStart: week, body: chandaBody(draft, notify, shown) },
                {
                  onSuccess: () => {
                    setEdits(null);
                    setNotify(false);
                    toast.show({ message: t('chanda.saved'), tone: 'success' });
                  },
                  onError: (error) => {
                    toast.show({ message: errorText(error), tone: 'error' });
                  },
                },
              );
            }}
          >
            {isSaved(chanda.data, week) ? t('chanda.update') : t('chanda.save')}
          </Button>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="chanda-history">
          <h2 id="chanda-history" className="type-headline text-text">
            {t('chanda.history')}
          </h2>
          {chanda.data.weeks.length === 0 ? (
            <InfoNote>{t('chanda.empty')}</InfoNote>
          ) : (
            <ul className="flex flex-col gap-2">
              {chanda.data.weeks.map((entry) => {
                const at = weeks.indexOf(entry.weekStart);
                const entryRange = weekRange(entry.weekStart);
                return (
                  <li key={entry.weekStart}>
                    <Pressable
                      kind="card"
                      disabled={at < 0}
                      onPress={() => {
                        if (at >= 0) pick(at);
                      }}
                      className="flex w-full items-center justify-between gap-3 rounded-md bg-surface p-4 text-start shadow-e1"
                      data-chanda-row={entry.weekStart}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="type-subhead-strong text-text">
                          {t('chanda.range', {
                            start: format.calendarDate(entryRange.start, 'medium'),
                            end: format.calendarDate(entryRange.end, 'medium'),
                          })}
                        </span>
                        {entry.note ? (
                          <span dir="auto" className="truncate type-footnote text-text-secondary">
                            {entry.note}
                          </span>
                        ) : null}
                      </span>
                      <span className="type-headline tabular-nums text-text">{format.money(entry.amountPaise)}</span>
                    </Pressable>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Screen>
  );
}
