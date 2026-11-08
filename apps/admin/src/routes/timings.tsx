import { type PrayerConfig, PRAYERS, resolveSchedule } from '@mc/domain/prayer';
import { calendarDateInZone } from '@mc/domain/time';
import { useTranslation } from '@mc/i18n/react';
import { PublishBar, PublishSuccess } from '@mc/ui/admin';
import { Button, Dialog, InfoNote, SkeletonText, useToast } from '@mc/ui/components';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { masjidApi, masjidKeys } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { useNotifyLine } from '../features/publish/notify-line.ts';
import { ConfirmSheet, JumuahEditor, PrayerCard, TimingsPreview } from '../features/timings/components/EditorParts.tsx';
import { AdhanSheet, JamaatSheet, TimeSheet } from '../features/timings/components/TimingSheets.tsx';
import { useTimingsEditor } from '../features/timings/hooks/use-timings-editor.ts';
import {
  addJumuah,
  allJamaatsSet,
  changesOn,
  isDirty,
  issuesOf,
  notifyByDefault,
  removeJumuah,
  scheduleFor,
  withJumuah,
  withPrayer,
} from '../features/timings/lib/editor.ts';

export const Route = createFileRoute('/timings')({
  component: Timings,
});

type Editing =
  | { readonly kind: 'adhan' | 'jamaat'; readonly prayer: (typeof PRAYERS)[number] }
  | { readonly kind: 'jumuah' | 'khutbah'; readonly seq: number }
  | null;

/**
 * B4 Prayer Times editor (07 B4, PHASE_03 T3.2): a card per prayer with big Adhan / Jamaat buttons and live checks,
 * Jumu'ah (1–3 jamaats), a preview of the musalli timetable, and the sticky bar — "Notify followers" (on when today's
 * or tomorrow's times change) + Save, which confirms with what changes today. Someone else's save in between is
 * caught (412) and the admin loads the latest.
 */
function Timings() {
  const { t } = useTranslation('admin');
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid: selected } = useSelectedMasjid(me.masjids);
  const masjidId = selected?.id;
  const editor = useTimingsEditor(masjidId);
  const quota = useQuery({
    queryKey: masjidKeys.quota(masjidId ?? ''),
    queryFn: ({ signal }) => masjidApi.quota(masjidId ?? '', signal),
    enabled: masjidId !== undefined,
  });
  const now = useMinute();
  const today = calendarDateInZone(now);
  const [editing, setEditing] = useState<Editing>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [done, setDone] = useState<{ readonly notified: boolean } | null>(null);

  const { masjid, draft, saved, setDraft } = editor;
  const view = useMemo(() => {
    if (!masjid || !draft) return null;
    const schedule = scheduleFor(masjid, draft);
    const issues = issuesOf(masjid, draft, today);
    return {
      day: resolveSchedule(schedule, today),
      issues,
      blocked: issues.some((issue) => issue.severity === 'error'),
      dirty: isDirty(saved, draft),
      changes: changesOn(masjid, saved, draft, today),
      notifyDefault: notifyByDefault(masjid, saved, draft, today),
    };
  }, [masjid, draft, saved, today]);

  const left = quota.data ? Math.max(quota.data.limit - quota.data.used, 0) : null;

  const notifyText = useNotifyLine(quota.data);
  const notify = left === 0 ? false : (notifyChoice ?? view?.notifyDefault ?? false);
  const save = (withNotify: boolean) => {
    editor.save.mutate(
      { notify: withNotify },
      {
        onSuccess: () => {
          setConfirming(false);
          setNotifyChoice(null);
          setDone({ notified: withNotify });
        },
        onError: (error) => {
          setConfirming(false);
          if (!(error instanceof Error) || editor.problem === 'other')
            toast.show({ message: errorText(error), tone: 'error' });
        },
      },
    );
  };
  /** Today's times for one prayer with a candidate config (the sheets' live result). */
  const resolveWith = (prayer: (typeof PRAYERS)[number]) => (config: PrayerConfig) => {
    if (!masjid || !draft) return { adhan: '00:00', jamaat: null };
    const day = resolveSchedule(scheduleFor(masjid, withPrayer(draft, prayer, config)), today);
    const resolved = day.prayers.find((p) => p.prayer === prayer);
    return { adhan: resolved?.adhan ?? '00:00', jamaat: resolved?.jamaat ?? null };
  };

  if (done) {
    return (
      <PublishSuccess
        title={t('timings.saved')}
        message={done.notified ? t('timings.savedNotified') : t('timings.savedQuiet')}
        doneLabel={t('timings.done')}
        onDone={() => {
          navigator.back();
        }}
      />
    );
  }

  return (
    <Screen
      title={t('timings.title')}
      actions={
        view ? (
          <Button
            variant="ghost"
            onPress={() => {
              setPreviewing(true);
            }}
          >
            {t('timings.preview')}
          </Button>
        ) : null
      }
    >
      {!draft || !view ? (
        <div aria-busy className="flex flex-col gap-4 py-4">
          {[0, 1, 2].map((row) => (
            <SkeletonText key={row} lines={3} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          {allJamaatsSet(draft) ? null : <InfoNote>{t('timings.needAll')}</InfoNote>}
          {PRAYERS.map((prayer) => {
            const resolved = view.day.prayers.find((p) => p.prayer === prayer);
            const config = draft.prayers[prayer];
            return (
              <PrayerCard
                key={prayer}
                prayer={prayer}
                today={{
                  adhan: resolved?.adhan ?? '00:00',
                  adhanCalculated: resolved?.adhanCalculated ?? true,
                  jamaat: resolved?.jamaat ?? null,
                }}
                jamaatMode={config.jamaatMode}
                jamaatOffsetMin={config.jamaatOffsetMin}
                issues={view.issues.filter((issue) => issue.prayer === prayer)}
                onAdhan={() => {
                  setEditing({ kind: 'adhan', prayer });
                }}
                onJamaat={() => {
                  setEditing({ kind: 'jamaat', prayer });
                }}
              />
            );
          })}
          <JumuahEditor
            jumuah={draft.jumuah}
            issues={view.issues.filter((issue) => issue.prayer === 'jumuah')}
            onJamaat={(seq) => {
              setEditing({ kind: 'jumuah', seq });
            }}
            onKhutbah={(seq) => {
              setEditing({ kind: 'khutbah', seq });
            }}
            onAdd={() => {
              setDraft(addJumuah(draft));
            }}
            onRemove={(seq) => {
              setDraft(removeJumuah(draft, seq));
            }}
          />
          <PublishBar
            notify={{
              checked: notify,
              onChange: setNotifyChoice,
              label: t('timings.notify'),
              quota: notifyText,
              disabled: left === 0,
            }}
            actionLabel={t('timings.save')}
            disabled={!view.dirty || view.blocked}
            busy={editor.save.isPending}
            onAction={() => {
              setConfirming(true);
            }}
          />
        </div>
      )}

      {draft && editing?.kind === 'adhan' ? (
        <AdhanSheet
          key={`adhan-${editing.prayer}`}
          open
          title={t('timings.adhanSheet', { prayer: prayerLabel(t, editing.prayer) })}
          config={draft.prayers[editing.prayer]}
          resolve={resolveWith(editing.prayer)}
          onClose={() => {
            setEditing(null);
          }}
          onDone={(config) => {
            setDraft(withPrayer(draft, editing.prayer, config));
            setEditing(null);
          }}
        />
      ) : null}
      {draft && editing?.kind === 'jamaat' ? (
        <JamaatSheet
          key={`jamaat-${editing.prayer}`}
          open
          title={t('timings.jamaatSheet', { prayer: prayerLabel(t, editing.prayer) })}
          config={draft.prayers[editing.prayer]}
          resolve={resolveWith(editing.prayer)}
          onClose={() => {
            setEditing(null);
          }}
          onDone={(config) => {
            setDraft(withPrayer(draft, editing.prayer, config));
            setEditing(null);
          }}
        />
      ) : null}
      {draft && (editing?.kind === 'jumuah' || editing?.kind === 'khutbah')
        ? (() => {
            const slot = draft.jumuah.find((entry) => entry.seq === editing.seq);
            if (!slot) return null;
            const khutbah = editing.kind === 'khutbah';
            return (
              <TimeSheet
                key={`${editing.kind}-${String(editing.seq)}`}
                open
                title={t(khutbah ? 'timings.khutbahSheet' : 'timings.jumuahSheet', { n: editing.seq })}
                value={khutbah ? (slot.khutbahTime ?? slot.jamaatTime) : slot.jamaatTime}
                onClose={() => {
                  setEditing(null);
                }}
                onDone={(value) => {
                  setDraft(
                    withJumuah(
                      draft,
                      slot.seq,
                      khutbah ? { ...slot, khutbahTime: value } : { ...slot, jamaatTime: value },
                    ),
                  );
                  setEditing(null);
                }}
                {...(khutbah
                  ? {
                      clearLabel: t('timings.noKhutbah'),
                      onClear: () => {
                        setDraft(withJumuah(draft, slot.seq, { jamaatTime: slot.jamaatTime }));
                        setEditing(null);
                      },
                    }
                  : {})}
              />
            );
          })()
        : null}

      {masjid && draft ? (
        <TimingsPreview
          open={previewing}
          onClose={() => {
            setPreviewing(false);
          }}
          today={today}
          resolve={(date) => resolveSchedule(scheduleFor(masjid, draft), date)}
        />
      ) : null}
      {view ? (
        <ConfirmSheet
          open={confirming}
          onClose={() => {
            setConfirming(false);
          }}
          changes={view.changes}
          notify={notify}
          busy={editor.save.isPending}
          onSave={() => {
            save(notify);
          }}
        />
      ) : null}
      <Dialog
        open={editor.problem === 'conflict'}
        onClose={() => {
          editor.save.reset();
        }}
        title={t('timings.conflictTitle')}
        body={t('timings.conflictBody')}
        confirmLabel={t('timings.loadLatest')}
        onConfirm={() => {
          setNotifyChoice(null);
          void editor.reload();
        }}
      />
      <Dialog
        open={editor.problem === 'quota'}
        onClose={() => {
          editor.save.reset();
        }}
        title={t('timings.quotaTitle')}
        body={t('timings.quotaBody')}
        confirmLabel={t('timings.saveWithout')}
        onConfirm={() => {
          editor.save.reset();
          save(false);
        }}
      />
    </Screen>
  );
}

/** A prayer's name in the admin language (the `common` namespace's prayer names). */
function prayerLabel(t: ReturnType<typeof useTranslation<'admin'>>['t'], prayer: (typeof PRAYERS)[number]): string {
  return t(`prayer.${prayer}`, { ns: 'common' });
}
