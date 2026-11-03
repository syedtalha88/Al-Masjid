import { addDays, calendarDateInZone } from '@mc/domain/time';
import { useLocale, useTranslation } from '@mc/i18n/react';
import { SPECIAL_TYPES, type SpecialType } from '@mc/shared/contracts';
import { ProblemError } from '@mc/shared/http';
import { PublishBar, PublishSuccess } from '@mc/ui/admin';
import {
  Button,
  DatePickerSheet,
  Dialog,
  EmptyState,
  IconCircle,
  RadioCardGroup,
  SkeletonText,
  TextArea,
  TextField,
  useToast,
} from '@mc/ui/components';
import { Screen, useNavigator, useScreen } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { masjidApi, masjidKeys } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import {
  IssueTags,
  PICK_FUTURE_DAYS,
  PICK_PAST_DAYS,
  SpecialPreview,
  SpecialTypeIcon,
  TimesEditor,
} from '../features/special/components/SpecialParts.tsx';
import { useSpecialDates, useSpecialDateWrites } from '../features/special/hooks/use-special.ts';
import {
  EMPTY_ENTRY,
  entryBody,
  entryDirty,
  type EntryDraft,
  entryDraftOf,
  entryIssues,
  entryNotifyDefault,
  firstTimeFor,
} from '../features/special/lib/special.ts';
import { SlotButton } from '../features/timings/components/EditorParts.tsx';
import { TimeSheet } from '../features/timings/components/TimingSheets.tsx';

export const Route = createFileRoute('/special/$id')({
  component: SpecialDateScreen,
});

/** The path id of a new entry (`/special/new`; saved entries use their UUID). */
const NEW = 'new';

/**
 * B11 special date (07 B11, PHASE_03 T3.3): what the day is (icon cards) → its date → 1–5 times, each with an optional
 * name → an optional title and note → Save, with "Notify followers" (on for today or tomorrow). A saved entry can be
 * changed or deleted; Preview shows the musalli Special Dates card.
 */
function SpecialDateScreen() {
  const { t } = useTranslation('admin');
  const { params } = useScreen();
  const entryId = params['id'] ?? NEW;
  const me = useSignedInAdmin();
  const { masjid: selected } = useSelectedMasjid(me.masjids);
  const specials = useSpecialDates(selected?.id);
  const errorText = useErrorText();
  const { t: te } = useTranslation('errors');

  if (entryId === NEW) return <Editor masjidId={selected?.id} entryId={null} saved={EMPTY_ENTRY} />;
  if (specials.isError) {
    return (
      <Screen title={t('special.editTitle')}>
        <EmptyState className="mt-8" title={errorText(specials.error)} />
      </Screen>
    );
  }
  if (!specials.data) {
    return (
      <Screen title={t('special.editTitle')}>
        <div aria-busy className="py-4">
          <SkeletonText lines={6} />
        </div>
      </Screen>
    );
  }
  const entry = specials.data.specialDates.find((candidate) => candidate.id === entryId);
  if (!entry) {
    return (
      <Screen title={t('special.editTitle')}>
        <EmptyState className="mt-8" title={te('SPECIAL_DATE_NOT_FOUND')} />
      </Screen>
    );
  }
  return <Editor key={entry.id} masjidId={selected?.id} entryId={entry.id} saved={entryDraftOf(entry)} />;
}

function Editor({
  masjidId,
  entryId,
  saved,
}: {
  readonly masjidId: string | undefined;
  readonly entryId: string | null;
  readonly saved: EntryDraft;
}) {
  const { t } = useTranslation('admin');
  const { format } = useLocale();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const today = calendarDateInZone(useMinute());
  const { save, remove, refresh, quotaExceeded } = useSpecialDateWrites(masjidId);
  const quota = useQuery({
    queryKey: masjidKeys.quota(masjidId ?? ''),
    queryFn: ({ signal }) => masjidApi.quota(masjidId ?? '', signal),
    enabled: masjidId !== undefined,
  });
  const [draft, setDraft] = useState(saved);
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [editingTime, setEditingTime] = useState<number | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState<{ readonly notified: boolean } | null>(null);

  const issues = entryIssues(draft, today);
  const left = quota.data ? Math.max(quota.data.limit - quota.data.used, 0) : null;
  const notify = left === 0 ? false : (notifyChoice ?? entryNotifyDefault(draft, today));
  const complete = entryBody(draft, false) !== null;
  const canSave = complete && issues.length === 0 && entryDirty(saved, draft);

  const submit = (withNotify: boolean) => {
    const body = entryBody(draft, withNotify);
    if (!body) return;
    save.mutate(
      { entryId, body },
      {
        onSuccess: () => {
          setDone({ notified: withNotify });
        },
        onError: (error) => {
          if (!quotaExceededError(error)) toast.show({ message: errorText(error), tone: 'error' });
        },
      },
    );
  };
  const setTime = (index: number, time: string) => {
    setDraft({ ...draft, times: draft.times.map((slot, i) => (i === index ? { ...slot, time } : slot)) });
  };

  if (done) {
    return (
      <PublishSuccess
        title={t('special.saved')}
        message={done.notified ? t('special.savedNotified') : t('special.savedQuiet')}
        doneLabel={t('special.done')}
        onDone={() => {
          navigator.back();
        }}
      />
    );
  }

  const body = entryBody(draft, false);
  return (
    <Screen
      title={entryId === null ? t('special.newTitle') : t('special.editTitle')}
      actions={
        body && draft.date ? (
          <Button
            variant="ghost"
            onPress={() => {
              setPreviewing(true);
            }}
          >
            {t('special.preview')}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-6 pb-4">
        <RadioCardGroup<SpecialType>
          legend={t('special.typeLegend')}
          name="special-type"
          options={SPECIAL_TYPES.map((type) => ({
            value: type,
            title: t(`special.type.${type}`),
            leading: (
              <IconCircle tone="sun" size={44}>
                <SpecialTypeIcon type={type} />
              </IconCircle>
            ),
          }))}
          value={draft.type}
          onChange={(type) => {
            setDraft({ ...draft, type });
          }}
        />

        <div className="flex flex-col gap-2">
          <h2 className="type-headline text-text">{t('special.date')}</h2>
          <div className="flex">
            <SlotButton
              label={t('special.date')}
              value={draft.date === null ? t('timings.notSet') : format.calendarDate(draft.date, 'long')}
              onPress={() => {
                setPickingDate(true);
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h2 className="type-headline text-text">{t('special.times')}</h2>
          <TimesEditor
            times={draft.times}
            onTime={setEditingTime}
            onLabel={(index, label) => {
              setDraft({ ...draft, times: draft.times.map((slot, i) => (i === index ? { ...slot, label } : slot)) });
            }}
            onAdd={() => {
              const last = draft.times.at(-1)?.time;
              setDraft({ ...draft, times: [...draft.times, { time: last ?? firstTimeFor(draft.type), label: '' }] });
              setEditingTime(draft.times.length);
            }}
            onRemove={(index) => {
              setDraft({ ...draft, times: draft.times.filter((_, i) => i !== index) });
            }}
          />
        </div>

        <TextField
          label={t('special.label')}
          optional
          hint={t('special.labelHint')}
          value={draft.label}
          maxLength={80}
          dir="auto"
          onChange={(event) => {
            setDraft({ ...draft, label: event.target.value });
          }}
        />
        <TextArea
          label={t('special.note')}
          optional
          value={draft.note}
          maxLength={300}
          rows={3}
          dir="auto"
          onChange={(event) => {
            setDraft({ ...draft, note: event.target.value });
          }}
        />
        <IssueTags issues={issues} prefix="special.issue" />

        {entryId === null ? null : (
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onPress={() => {
              setDeleting(true);
            }}
          >
            {t('special.delete')}
          </Button>
        )}

        <PublishBar
          notify={{
            checked: notify,
            onChange: setNotifyChoice,
            label: t('special.notify'),
            quota: quota.data && left !== null ? t('special.quota', { left, limit: quota.data.limit }) : undefined,
            disabled: left === 0,
          }}
          actionLabel={t('special.save')}
          disabled={!canSave}
          busy={save.isPending}
          onAction={() => {
            submit(notify);
          }}
        />
      </div>

      {editingTime !== null && draft.times[editingTime] ? (
        <TimeSheet
          key={`time-${String(editingTime)}`}
          open
          title={t('special.timeSheet', { n: editingTime + 1 })}
          value={draft.times[editingTime].time}
          onClose={() => {
            setEditingTime(null);
          }}
          onDone={(value) => {
            setTime(editingTime, value);
            setEditingTime(null);
          }}
        />
      ) : null}
      <DatePickerSheet
        open={pickingDate}
        onClose={() => {
          setPickingDate(false);
        }}
        title={t('special.pickDate')}
        value={draft.date}
        min={addDays(today, -PICK_PAST_DAYS)}
        max={addDays(today, PICK_FUTURE_DAYS)}
        today={today}
        onChange={(date) => {
          setDraft({ ...draft, date });
          setPickingDate(false);
        }}
      />
      {body && draft.date ? (
        <SpecialPreview
          open={previewing}
          onClose={() => {
            setPreviewing(false);
          }}
          date={draft.date}
          entry={body}
        />
      ) : null}
      {entryId === null ? null : (
        <Dialog
          open={deleting}
          destructive
          loading={remove.isPending}
          onClose={() => {
            setDeleting(false);
          }}
          title={t('special.deleteTitle')}
          body={t('special.deleteBody')}
          confirmLabel={t('special.delete')}
          onConfirm={() => {
            remove.mutate(entryId, {
              onSuccess: () => {
                setDeleting(false);
                toast.show({ message: t('special.deleted'), tone: 'success' });
                navigator.back();
                void refresh();
              },
              onError: (error) => {
                setDeleting(false);
                toast.show({ message: errorText(error), tone: 'error' });
              },
            });
          }}
        />
      )}
      <Dialog
        open={quotaExceeded}
        onClose={() => {
          save.reset();
        }}
        title={t('special.quotaTitle')}
        body={t('special.quotaBody')}
        confirmLabel={t('special.saveWithout')}
        onConfirm={() => {
          save.reset();
          submit(false);
        }}
      />
    </Screen>
  );
}

/** The quota dialog handles this one; every other failure is a toast. */
const quotaExceededError = (error: unknown): boolean =>
  error instanceof ProblemError && error.problem.code === 'NOTIFY_QUOTA_EXCEEDED';
