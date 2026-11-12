// Where the Qibla is computed from (07 A14, 05 §1, PHASE_07 T7.2): "Use my location" on a tap (10 s), kept on the phone
// only and rounded to ~1 km; otherwise the first followed masjid's location ("Using: <masjid>"). Nothing here sends
// coordinates anywhere — the bearing is computed on the phone.
import type { Coordinates } from '@mc/domain/geo';
import { useLocale } from '@mc/i18n/react';
import { useState } from 'react';

import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import { masjidName } from '../../../lib/masjid.ts';
import { useHomeData } from '../../home/hooks/useHomeData.ts';

/** 07 A14: the location request gives up after 10 s. */
export const LOCATION_TIMEOUT_MS = 10_000;

export type LocationSource =
  | { readonly kind: 'device'; readonly at: Coordinates }
  | { readonly kind: 'masjid'; readonly at: Coordinates; readonly name: string }
  | { readonly kind: 'none' };

export type LocationAsk = 'idle' | 'asking' | 'denied' | 'unavailable';

/**
 * Rounded to 2 decimals (~1.1 km): the bearing moves by under 0.05° anywhere in India, the distance by about 1 km — and
 * a lost or shared phone does not hold the person's home (05 §1).
 */
export const roundCoordinates = (at: Coordinates): Coordinates => ({
  lat: Math.round(at.lat * 100) / 100,
  lng: Math.round(at.lng * 100) / 100,
});

export function useQiblaLocation() {
  const { locale } = useLocale();
  const { store } = useAppData();
  const saved = useDeviceSelector((state) => state.qibla);
  const home = useHomeData();
  const [ask, setAsk] = useState<LocationAsk>('idle');

  const first = home.masjids.find((entry) => entry.state === 'active');
  const masjid: LocationSource | null =
    first?.state === 'active'
      ? {
          kind: 'masjid',
          at: { lat: first.bundle.masjid.lat, lng: first.bundle.masjid.lng },
          name: masjidName(first.bundle.masjid, locale),
        }
      : null;
  const source: LocationSource = saved ? { kind: 'device', at: saved } : (masjid ?? { kind: 'none' });
  /** The followed masjid's name while the phone's location is used — "Use <masjid> instead" (07 A14). */
  const fallbackName = saved && masjid?.kind === 'masjid' ? masjid.name : null;

  /** "Use my location": the browser asks for permission on first use; the result stays on this phone. */
  const locateMe = () => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setAsk('unavailable');
      return;
    }
    setAsk('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const at = roundCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude });
        void store
          .update((state) => ({ ...state, qibla: at }))
          .then(() => {
            setAsk('idle');
          });
      },
      (error) => {
        setAsk(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: 10 * 60 * 1000 },
    );
  };

  /** Forgets the phone's location (travel, privacy): the page goes back to the followed masjid's location. */
  const forget = () => {
    setAsk('idle');
    void store.update(({ qibla: _dropped, ...state }) => state);
  };

  return { source, ask, locateMe, forget, fallbackName };
}
