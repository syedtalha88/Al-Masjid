import { parseCoordinates } from '@mc/domain/geo';
import { useTranslation } from '@mc/i18n/react';
import {
  ASR_MADHABS,
  CALC_METHODS,
  INDIA_BOUNDS,
  type SuperMasjidCreate,
  type SuperMasjidDetail,
} from '@mc/shared/contracts';
import { Button, InfoNote, SectionHeader, Select, TextField } from '@mc/ui/components';
import { type SyntheticEvent, useId, useState } from 'react';

type CalcMethod = (typeof CALC_METHODS)[number];
type AsrMadhab = (typeof ASR_MADHABS)[number];
type Offset = 'none' | '-2' | '-1' | '0' | '1' | '2';

/** What the form produces: the create body, with the Hijri offset explicit (`null` = use the global setting). */
export type MasjidFormResult = Omit<SuperMasjidCreate, 'hijriOffset'> & { hijriOffset: -2 | -1 | 0 | 1 | 2 | null };

export interface MasjidFormProps {
  readonly initial?: SuperMasjidDetail['masjid'];
  readonly submitLabel: string;
  readonly busy: boolean;
  /** A server error message to show above the button. */
  readonly error?: string | null;
  readonly onSubmit: (values: MasjidFormResult) => void;
}

const inIndia = (lat: number, lng: number) =>
  lat >= INDIA_BOUNDS.lat[0] && lat <= INDIA_BOUNDS.lat[1] && lng >= INDIA_BOUNDS.lng[0] && lng <= INDIA_BOUNDS.lng[1];

/**
 * C2 masjid form (create and edit): names in 4 scripts, area/city/state/address, location from typed coordinates or a
 * pasted Google Maps link (checked to be inside India, 02 §2), calculation method, Asr madhab, Hijri adjustment.
 */
export function MasjidForm({ initial, submitLabel, busy, error, onSubmit }: MasjidFormProps) {
  const { t } = useTranslation('super');
  const formId = useId();
  const [name, setName] = useState(initial?.name ?? '');
  const [nameHi, setNameHi] = useState(initial?.nameI18n.hi ?? '');
  const [nameUr, setNameUr] = useState(initial?.nameI18n.ur ?? '');
  const [nameTe, setNameTe] = useState(initial?.nameI18n.te ?? '');
  const [area, setArea] = useState(initial?.area ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [state, setState] = useState(initial?.state ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [location, setLocation] = useState(initial ? `${String(initial.lat)}, ${String(initial.lng)}` : '');
  const [calcMethod, setCalcMethod] = useState<CalcMethod>(initial?.calcMethod ?? 'karachi');
  const [asrMadhab, setAsrMadhab] = useState<AsrMadhab>(initial?.asrMadhab ?? 'hanafi');
  const [offset, setOffset] = useState<Offset>(
    initial?.hijriOffset === undefined ? 'none' : (String(initial.hijriOffset) as Offset), // -2..2 from the API
  );
  const [touched, setTouched] = useState(false);

  const coordinates = location.trim() ? parseCoordinates(location) : null;
  const locationError = !location.trim()
    ? touched
      ? t('form.required')
      : undefined
    : !coordinates
      ? t('form.locationInvalid')
      : !inIndia(coordinates.lat, coordinates.lng)
        ? t('form.locationOutside')
        : undefined;
  const required = (value: string) => (touched && !value.trim() ? t('form.required') : undefined);

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!name.trim() || !city.trim() || !state.trim() || !coordinates || locationError) return;
    onSubmit({
      name: name.trim(),
      nameI18n: {
        ...(nameHi.trim() ? { hi: nameHi.trim() } : {}),
        ...(nameUr.trim() ? { ur: nameUr.trim() } : {}),
        ...(nameTe.trim() ? { te: nameTe.trim() } : {}),
      },
      area: area.trim(),
      city: city.trim(),
      state: state.trim(),
      address: address.trim(),
      lat: coordinates.lat,
      lng: coordinates.lng,
      calcMethod,
      asrMadhab,
      hijriOffset: offset === 'none' ? null : (Number(offset) as -2 | -1 | 0 | 1 | 2), // one of the five options
    });
  };

  return (
    <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField
        label={t('form.name')}
        value={name}
        maxLength={120}
        error={required(name)}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <TextField
        label={t('form.nameUr')}
        optional
        lang="ur"
        dir="rtl"
        value={nameUr}
        maxLength={120}
        onChange={(e) => {
          setNameUr(e.target.value);
        }}
      />
      <TextField
        label={t('form.nameHi')}
        optional
        lang="hi"
        value={nameHi}
        maxLength={120}
        onChange={(e) => {
          setNameHi(e.target.value);
        }}
      />
      <TextField
        label={t('form.nameTe')}
        optional
        lang="te"
        value={nameTe}
        maxLength={120}
        onChange={(e) => {
          setNameTe(e.target.value);
        }}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={t('form.area')}
          value={area}
          maxLength={80}
          onChange={(e) => {
            setArea(e.target.value);
          }}
        />
        <TextField
          label={t('form.city')}
          value={city}
          maxLength={80}
          error={required(city)}
          onChange={(e) => {
            setCity(e.target.value);
          }}
        />
        <TextField
          label={t('form.state')}
          value={state}
          maxLength={80}
          error={required(state)}
          onChange={(e) => {
            setState(e.target.value);
          }}
        />
      </div>
      <TextField
        label={t('form.address')}
        value={address}
        maxLength={300}
        onChange={(e) => {
          setAddress(e.target.value);
        }}
      />
      <TextField
        label={t('form.location')}
        value={location}
        inputMode="url"
        dir="ltr"
        hint={
          coordinates && !locationError
            ? t('form.locationFound', { latitude: coordinates.lat.toFixed(6), longitude: coordinates.lng.toFixed(6) })
            : t('form.locationHint')
        }
        error={locationError}
        onChange={(e) => {
          setLocation(e.target.value);
        }}
      />

      <SectionHeader title={t('form.calcMethod')} level={2} className="mt-2" />
      <Select<CalcMethod>
        label={t('form.calcMethod')}
        value={calcMethod}
        onChange={setCalcMethod}
        options={CALC_METHODS.map((value) => ({ value, label: t(`form.calcMethods.${value}`) }))}
      />
      <Select<AsrMadhab>
        label={t('form.asrMadhab')}
        value={asrMadhab}
        onChange={setAsrMadhab}
        options={ASR_MADHABS.map((value) => ({ value, label: t(`form.madhabs.${value}`) }))}
      />
      <Select<Offset>
        label={t('form.hijriOffset')}
        value={offset}
        onChange={setOffset}
        options={[
          { value: 'none', label: t('form.hijriOffsetNone') },
          ...(['-2', '-1', '0', '1', '2'] as const).map((value) => ({
            value,
            label: value.startsWith('-') || value === '0' ? value : `+${value}`,
          })),
        ]}
      />

      <div aria-live="polite">{error ? <InfoNote>{error}</InfoNote> : null}</div>
      <Button type="submit" size="lg" fullWidth loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
