// Where the Qibla is computed from (07 A14, 05 §1, PHASE_07 T7.2): "Use my location" on a tap (10 s), kept on the phone
// only and rounded to ~100 m; otherwise the first followed masjid's location ("Using: <masjid>"). Nothing here sends
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

/** Rounded to 3 decimals (~110 m): enough for a direction, less precise than the phone knows (05 §1). */
export const roundCoordinates = (at: Coordinates): Coordinates => ({
  lat: Math.round(at.lat * 1000) / 1000,
  lng: Math.round(at.lng * 1000) / 1000,
});

export function useQiblaLocation() {
  const { locale } = useLocale();
  const { store } = useAppData();
  const saved = useDeviceSelector((state) => state.qibla);
  const home = useHomeData();
  const [ask, setAsk] = useState<LocationAsk>('idle');

  const first = home.masjids.find((entry) => entry.state === 'active');
  const source: LocationSource = saved
    ? { kind: 'device', at: saved }
    : first?.state === 'active'
      ? {
          kind: 'masjid',
          at: { lat: first.bundle.masjid.lat, lng: first.bundle.masjid.lng },
          name: masjidName(first.bundle.masjid, locale),
        }
      : { kind: 'none' };

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

  return { source, ask, locateMe };
}
