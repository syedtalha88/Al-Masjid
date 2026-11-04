// B13 parts (07 B13, PHASE_03 T3.10): the photo (ownership tick first, then the picker — as for notice photos, 05 §9),
// the names in four scripts and the place (view — changes go to the Super Admin through "Request change"), and the
// Hijri adjustment with today's Hijri date for the chosen value.
import { toHijri } from '@mc/domain/hijri';
import { calendarDateInZone } from '@mc/domain/time';
import { LOCALES, NATIVE_NAME } from '@mc/i18n/locales';
import { useHijriLabel, useTranslation } from '@mc/i18n/react';
import type { AdminMasjidProfile } from '@mc/shared/contracts';
import { Button, Card, Checkbox, Image, SegmentedControl, Sheet, Spinner, TextArea, useToast } from '@mc/ui/components';
import { type ChangeEvent, useRef, useState } from 'react';

import { useErrorText } from '../../auth/hooks/use-session.ts';
import { useChangeRequest, useHijriOffset, useMasjidPhoto } from '../hooks/use-profile.ts';

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp,image/avif';

/** The photo and "Change photo" — the picker opens only once the ownership box is ticked. */
export function PhotoSection({
  masjidId,
  profile,
}: {
  readonly masjidId: string | undefined;
  readonly profile: AdminMasjidProfile;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const upload = useMasjidPhoto(masjidId);
  const [rights, setRights] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    upload.mutate(file, {
      onSuccess: () => {
        setRights(false);
        toast.show({ message: t('profile.photoChanged') });
      },
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-photo">
      <h2 id="profile-photo" className="type-headline text-text">
        {t('profile.photo')}
      </h2>
      {profile.photo ? (
        <Image
          src={profile.photo.url ?? null}
          alt={t('profile.photoAlt')}
          thumbhash={profile.photo.thumbhash}
          ratio="16/10"
        />
      ) : (
        <p className="type-callout text-text-secondary">{t('profile.photoNone')}</p>
      )}
      <Checkbox checked={rights} onChange={setRights} label={t('notice.rights')} description={t('notice.rightsHint')} />
      <input
        ref={input}
        type="file"
        accept={PHOTO_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={choose}
      />
      {upload.isPending ? (
        <p className="flex min-h-14 items-center gap-3 type-callout text-text-secondary" aria-live="polite">
          <Spinner size={24} />
          {t('notice.uploading')}
        </p>
      ) : (
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          disabled={!rights}
          onPress={() => {
            input.current?.click();
          }}
        >
          {t('profile.changePhoto')}
        </Button>
      )}
    </section>
  );
}

/** The names in each script and the place (view only), and "Request a change". */
export function NamesSection({
  masjidId,
  profile,
}: {
  readonly masjidId: string | undefined;
  readonly profile: AdminMasjidProfile;
}) {
  const { t } = useTranslation('admin');
  const [asking, setAsking] = useState(false);
  const nameIn = (locale: (typeof LOCALES)[number]) => (locale === 'en' ? profile.name : profile.nameI18n[locale]);
  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-names">
      <h2 id="profile-names" className="type-headline text-text">
        {t('profile.names')}
      </h2>
      <Card className="flex flex-col divide-y divide-border p-0" data-names>
        {LOCALES.map((locale) => {
          const name = nameIn(locale);
          return (
            <div key={locale} className="flex flex-col gap-0.5 px-4 py-3">
              <span lang={locale} className="type-caption text-text-tertiary">
                {NATIVE_NAME[locale]}
              </span>
              {name ? (
                <span lang={locale} dir="auto" className="type-body text-text">
                  {name}
                </span>
              ) : (
                <span className="type-body text-text-tertiary">{t('profile.notSet')}</span>
              )}
            </div>
          );
        })}
      </Card>
      <h2 className="type-headline text-text">{t('profile.place')}</h2>
      <Card className="flex flex-col gap-1">
        <span dir="auto" className="type-body text-text">
          {[profile.area, profile.city, profile.state].join(', ')}
        </span>
        {profile.address ? (
          <span dir="auto" className="type-callout text-text-secondary">
            {profile.address}
          </span>
        ) : null}
      </Card>
      <Button
        variant="outline"
        size="lg"
        fullWidth
        onPress={() => {
          setAsking(true);
        }}
      >
        {t('profile.requestChange')}
      </Button>
      <RequestChangeSheet
        open={asking}
        masjidId={masjidId}
        onClose={() => {
          setAsking(false);
        }}
      />
    </section>
  );
}

/** "Request a change": a short note for the Masjid Connect team. */
function RequestChangeSheet({
  open,
  masjidId,
  onClose,
}: {
  readonly open: boolean;
  readonly masjidId: string | undefined;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const errorText = useErrorText();
  const send = useChangeRequest(masjidId);
  const [note, setNote] = useState('');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('profile.requestTitle')}
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={note.trim() === ''}
          loading={send.isPending}
          onPress={() => {
            send.mutate(note.trim(), {
              onSuccess: () => {
                setNote('');
                onClose();
                toast.show({ message: t('profile.requestSent') });
              },
              onError: (error) => {
                toast.show({ message: errorText(error), tone: 'error' });
              },
            });
          }}
        >
          {t('profile.send')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-4">
        <p className="type-callout text-text-secondary">{t('profile.requestHint')}</p>
        <TextArea
          label={t('profile.requestNote')}
          value={note}
          maxLength={300}
          rows={4}
          dir="auto"
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>
    </Sheet>
  );
}

const OFFSETS = ['-2', '-1', '0', '1', '2'] as const;
type OffsetId = (typeof OFFSETS)[number];
const offsetLabel = (id: OffsetId) => (id.startsWith('-') ? `−${id.slice(1)}` : id === '0' ? '0' : `+${id}`);

/** The Hijri adjustment: −2…+2 days, today's Hijri date for the chosen value, "Follow the app's date". */
export function HijriSection({
  masjidId,
  profile,
  now,
}: {
  readonly masjidId: string | undefined;
  readonly profile: AdminMasjidProfile;
  readonly now: Date;
}) {
  const { t } = useTranslation('admin');
  const hijriLabel = useHijriLabel();
  const toast = useToast();
  const errorText = useErrorText();
  const save = useHijriOffset(masjidId);
  const effective = profile.hijriOffset ?? profile.globalHijriOffset;
  const today = toHijri(calendarDateInZone(now), effective);
  const set = (offset: number | null) => {
    save.mutate(offset, {
      onSuccess: () => {
        toast.show({ message: t('profile.saved') });
      },
      onError: (error) => {
        toast.show({ message: errorText(error), tone: 'error' });
      },
    });
  };
  return (
    <section className="flex flex-col gap-3" aria-labelledby="profile-hijri" data-hijri>
      <div className="flex flex-col gap-1">
        <h2 id="profile-hijri" className="type-headline text-text">
          {t('profile.hijri')}
        </h2>
        <p className="type-footnote text-text-secondary">{t('profile.hijriHint')}</p>
      </div>
      <SegmentedControl<OffsetId>
        label={t('profile.hijriDays')}
        segments={OFFSETS.map((id) => ({ id, label: offsetLabel(id) }))}
        value={OFFSETS.find((id) => Number(id) === effective) ?? '0'}
        onChange={(id) => {
          set(Number(id));
        }}
      />
      {today ? (
        <p className="type-body text-text" aria-live="polite">
          {t('profile.hijriToday', { date: hijriLabel(today) })}
        </p>
      ) : null}
      {profile.hijriOffset === null ? (
        <p className="type-footnote text-text-secondary">{t('profile.hijriFollowing')}</p>
      ) : (
        <Button
          variant="ghost"
          size="lg"
          onPress={() => {
            set(null);
          }}
        >
          {t('profile.hijriFollow')}
        </Button>
      )}
    </section>
  );
}
