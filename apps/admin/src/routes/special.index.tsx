import { calendarDateInZone } from '@mc/domain/time';
import { useTranslation } from '@mc/i18n/react';
import { Button, EmptyState, SectionHeader, SkeletonText, useToast } from '@mc/ui/components';
import { CalendarIcon, PlusIcon } from '@mc/ui/icons';
import { Screen, useNavigator } from '@mc/ui/navigation';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { useErrorText, useSignedInAdmin } from '../features/auth/hooks/use-session.ts';
import { masjidApi, masjidKeys } from '../features/home/api/masjid-api.ts';
import { useMinute } from '../features/home/hooks/use-minute.ts';
import { useSelectedMasjid } from '../features/home/hooks/use-selected-masjid.ts';
import { RamadanCard, SpecialRow } from '../features/special/components/SpecialParts.tsx';
import { useRamadan, useSpecialDates } from '../features/special/hooks/use-special.ts';
import { ramadanBody, splitByToday } from '../features/special/lib/special.ts';

export const Route = createFileRoute('/special/')({
  component: SpecialDates,
});

/**
 * B11 Special Dates & Ramadan (07 B11, PHASE_03 T3.3): the Ramadan card, then the special dates — today and later in
 * date order, the last 30 days under "Past" (still editable) — and "Add special date". Followers see changes after
 * their next version poll.
 */
function SpecialDates() {
  const { t } = useTranslation('admin');
  const { t: tc } = useTranslation();
  const navigator = useNavigator();
  const toast = useToast();
  const errorText = useErrorText();
  const me = useSignedInAdmin();
  const { masjid: selected } = useSelectedMasjid(me.masjids);
  const masjidId = selected?.id;
  const today = calendarDateInZone(useMinute());
  const schedule = useQuery({
    queryKey: masjidKeys.schedule(masjidId ?? ''),
    queryFn: ({ signal }) => masjidApi.schedule(masjidId ?? '', signal),
    enabled: masjidId !== undefined,
  });
  const specials = useSpecialDates(masjidId);
  const { ramadan, save } = useRamadan(masjidId);
  const add = () => {
    navigator.push('/special/new');
  };

  const lists = specials.data ? splitByToday(specials.data.specialDates, today) : null;
  const failed = [schedule, ramadan, specials].find((query) => query.isError);
  if (failed) {
    return (
      <Screen title={t('special.title')}>
        <EmptyState
          className="mt-8"
          title={errorText(failed.error)}
          action={
            <Button
              size="lg"
              onPress={() => {
                for (const query of [schedule, ramadan, specials]) if (query.isError) void query.refetch();
              }}
            >
              {tc('appError.retry')}
            </Button>
          }
        />
      </Screen>
    );
  }
  return (
    <Screen title={t('special.title')}>
      <div className="flex flex-col gap-6 pb-6">
        {schedule.data && ramadan.data ? (
          <RamadanCard
            // A fresh card (and draft) for every saved state.
            key={JSON.stringify(ramadan.data)}
            masjid={schedule.data.masjid}
            saved={ramadan.data}
            today={today}
            busy={save.isPending}
            onSave={(draft) => {
              const body = ramadanBody(draft);
              if (!body) return;
              save.mutate(body, {
                onSuccess: () => {
                  toast.show({ message: t('special.ramadanSaved'), tone: 'success' });
                },
                onError: (error) => {
                  toast.show({ message: errorText(error), tone: 'error' });
                },
              });
            }}
          />
        ) : (
          <div aria-busy>
            <SkeletonText lines={4} />
          </div>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="special-dates">
          <SectionHeader id="special-dates" title={t('special.dates')} />
          {!lists ? (
            <div aria-busy className="flex flex-col gap-3">
              <SkeletonText lines={2} />
              <SkeletonText lines={2} />
            </div>
          ) : lists.upcoming.length === 0 && lists.past.length === 0 ? (
            <EmptyState
              illustration={<CalendarIcon size={48} />}
              title={t('special.emptyTitle')}
              body={t('special.emptyBody')}
              action={
                <Button size="lg" leadingIcon={<PlusIcon />} onPress={add}>
                  {t('special.add')}
                </Button>
              }
            />
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {lists.upcoming.map((entry) => (
                  <li key={entry.id}>
                    <SpecialRow
                      entry={entry}
                      onPress={() => {
                        navigator.push(`/special/${entry.id}`);
                      }}
                    />
                  </li>
                ))}
              </ul>
              <Button size="lg" variant="outline" fullWidth leadingIcon={<PlusIcon />} onPress={add}>
                {t('special.add')}
              </Button>
              {lists.past.length > 0 ? (
                <section className="flex flex-col gap-3" aria-labelledby="special-past">
                  <SectionHeader id="special-past" level={3} title={t('special.past')} />
                  <ul className="flex flex-col gap-3">
                    {lists.past.map((entry) => (
                      <li key={entry.id}>
                        <SpecialRow
                          entry={entry}
                          onPress={() => {
                            navigator.push(`/special/${entry.id}`);
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </section>
      </div>
    </Screen>
  );
}
