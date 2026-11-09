// Notifications controls (PHASE_04 T4.2, 07 A15 §3, A1 step 7, soft-ask): the status for this phone, turning them on
// (from a tap only) and off, and the "Not now" answer. The permission is read again when the app comes back to the
// front — the person may have allowed or blocked notifications in the phone's settings meanwhile.
import { useEffect, useMemo, useState } from 'react';

import { useAppData, useDeviceSelector } from '../../../lib/data.tsx';
import { isStandalone, platformKind } from '../../../lib/platform.ts';
import {
  browserPushPlatform,
  canOfferPush,
  declinePush,
  disablePush,
  enablePush,
  type PushPlatform,
  type PushStatus,
  pushStatus,
} from '../../../lib/push.ts';

export interface PushControls {
  readonly status: PushStatus;
  readonly platform: PushPlatform['platform'];
  /** Push can be offered here (Android any mode, iOS installed only — 00 §4.4). */
  readonly offerable: boolean;
  readonly busy: boolean;
  /** The last action failed (network / server) — the screen offers "Try again". */
  readonly failed: boolean;
  enable(): Promise<PushStatus>;
  disable(): Promise<PushStatus>;
  decline(): Promise<void>;
}

/** @param env - the browser (tests pass a fake). */
export function usePushControls(env?: PushPlatform): PushControls {
  const { store, api } = useAppData();
  const wanted = useDeviceSelector((state) => state.push?.wanted ?? false);
  const platform = useMemo(() => env ?? browserPushPlatform(platformKind(), isStandalone()), [env]);
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setTick((tick) => tick + 1);
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const run = async (action: () => Promise<PushStatus>): Promise<PushStatus> => {
    setBusy(true);
    setFailed(false);
    try {
      return await action();
    } catch {
      setFailed(true);
      return pushStatus(platform, wanted);
    } finally {
      setBusy(false);
      setTick((tick) => tick + 1);
    }
  };

  return {
    status: pushStatus(platform, wanted),
    platform: platform.platform,
    offerable: canOfferPush(platform),
    busy,
    failed,
    enable: () => run(() => enablePush(platform, api, store)),
    disable: () => run(() => disablePush(platform, api, store)),
    decline: () => declinePush(store),
  };
}
