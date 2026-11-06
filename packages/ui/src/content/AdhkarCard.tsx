// "Adhkar after salah" Home card (07 A20) — shared by the musalli Home and the admin B16 preview (T3.11: the preview
// renders the real component): "Adhkar after salah · <prayer>", the masjid, the first dhikr's Arabic (Amiri, never
// mirrored, three lines at most), "See all", and a dismiss button. Text only from the verified Content Library.
import { useTranslation } from '@mc/i18n/react';

import { ArabicText } from '../components/ArabicText.tsx';
import { Button, IconButton } from '../components/Button.tsx';
import { Card } from '../components/Card.tsx';
import { IconCircle } from '../components/IconCircle.tsx';
import { MoonStarsIcon } from '../icons/glyph/MoonStarsIcon.tsx';
import { XIcon } from '../icons/glyph/XIcon.tsx';

export interface AdhkarCardProps {
  readonly prayer: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | 'jumuah';
  /** The masjid's name in the app language, when known. */
  readonly masjid?: string | undefined;
  /** The first dhikr of the set. */
  readonly arabic: string;
  readonly onSeeAll: () => void;
  readonly onDismiss: () => void;
}

export function AdhkarCard({ prayer, masjid, arabic, onSeeAll, onDismiss }: AdhkarCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-3" data-adhkar-card>
      <div className="flex items-start gap-3">
        <IconCircle tone="primary" size={44}>
          <MoonStarsIcon />
        </IconCircle>
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="type-headline text-text">{t('home.adhkar', { prayer: t(`prayer.${prayer}`) })}</h2>
          {masjid ? <p className="truncate type-footnote text-text-secondary">{masjid}</p> : null}
        </div>
        <IconButton label={t('home.adhkarDismiss')} icon={<XIcon />} onPress={onDismiss} />
      </div>
      <ArabicText className="line-clamp-3">{arabic}</ArabicText>
      <Button variant="secondary" fullWidth onPress={onSeeAll}>
        {t('ui.seeAll')}
      </Button>
    </Card>
  );
}
