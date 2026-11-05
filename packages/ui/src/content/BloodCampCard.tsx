// Blood donation camp card (07 A22, DECISIONS #104 / #132) — shared by Home, Masjid Detail and the admin B5 preview of a
// camp notice (T3.11: the preview renders the real component): drop icon, "Blood donation camp", the masjid (on Home),
// date · hours, place — that part opens the announcement — and "Contact on WhatsApp" for the organiser. The number is
// not printed here (the notice text has it). No donor list, no blood groups (00 §4.13).
import { useLocale, useTranslation } from '@mc/i18n/react';

import { Card } from '../components/Card.tsx';
import { IconCircle } from '../components/IconCircle.tsx';
import { DropIcon } from '../icons/glyph/DropIcon.tsx';
import { Pressable } from '../motion/Pressable.tsx';
import type { BloodCamp } from './camp-view.ts';
import { WhatsAppButton } from './WhatsAppButton.tsx';

export interface BloodCampCardProps {
  readonly camp: Pick<BloodCamp, 'date' | 'hours' | 'place' | 'contact'>;
  /** The masjid's name in the app language (Home, where several masjids mix). */
  readonly masjid?: string | undefined;
  /** Opens the announcement detail; absent in the admin preview. */
  readonly onOpen?: () => void;
  readonly preview?: boolean;
}

export function BloodCampCard({ camp, masjid, onOpen, preview = false }: BloodCampCardProps) {
  const { t } = useTranslation();
  const { format } = useLocale();
  const when = t('ui.camp.when', {
    date: format.calendarDate(camp.date, 'medium'),
    start: format.time(camp.hours.start).text,
    end: format.time(camp.hours.end).text,
  });
  const summary = (
    <div className="flex items-start gap-3">
      <IconCircle tone="danger" size={44}>
        <DropIcon />
      </IconCircle>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-start">
        <h2 className="type-headline text-text">{t('ui.camp.title')}</h2>
        {masjid ? <p className="truncate type-footnote text-text-secondary">{masjid}</p> : null}
        <p className="type-subhead text-text">{when}</p>
        <p dir="auto" className="type-subhead text-text-secondary break-words">
          {camp.place}
        </p>
      </div>
    </div>
  );
  return (
    <Card className="flex flex-col gap-3" data-blood-camp>
      {onOpen ? (
        <Pressable kind="card" className="-m-2 block rounded-sm p-2" onPress={onOpen}>
          {summary}
        </Pressable>
      ) : (
        summary
      )}
      <WhatsAppButton number={camp.contact} label={t('ui.camp.contact')} preview={preview} />
    </Card>
  );
}
