// One special date as the musalli A6 "Special Dates" tab shows it (07 A6, 00 §4.2): the type with the masjid's label,
// its times as chips (each with an optional label) and the note. Shared by the musalli app and the admin B11 preview
// (T3.3 — the preview renders exactly this, never a copy).
import { Bdi, useLocale, useTranslation } from '@mc/i18n/react';

import { IconCircle } from '../components/IconCircle.tsx';
import { CrescentIcon } from '../icons/glyph/CrescentIcon.tsx';

export interface SpecialDateCardProps {
  readonly special: {
    readonly type: 'eid_ul_fitr' | 'eid_ul_adha' | 'taraweeh' | 'shab_e_barat' | 'shab_e_qadr' | 'other';
    readonly label?: string | undefined;
    readonly times: readonly { readonly time: string; readonly label?: string | undefined }[];
    readonly note?: string | undefined;
  };
}

export function SpecialDateCard({ special }: SpecialDateCardProps) {
  const { t } = useTranslation('masjid');
  const { format } = useLocale();
  return (
    <div className="flex items-start gap-3 rounded-lg bg-surface p-3 shadow-e1">
      <IconCircle tone="primary" size={44}>
        <CrescentIcon />
      </IconCircle>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="type-headline text-text">
          {t(`special.${special.type}`)}
          {special.label ? <span className="type-callout text-text-secondary"> · {special.label}</span> : null}
        </p>
        <p className="flex flex-wrap gap-1.5">
          {special.times.map((entry) => (
            <span
              key={`${entry.time}-${entry.label ?? ''}`}
              className="rounded-full bg-mint-50 px-3 py-1 type-caption text-primary-800"
            >
              <Bdi>{format.time(entry.time).text}</Bdi>
              {entry.label ? ` · ${entry.label}` : ''}
            </span>
          ))}
        </p>
        {special.note ? <p className="type-footnote text-text-secondary">{special.note}</p> : null}
      </div>
    </div>
  );
}
