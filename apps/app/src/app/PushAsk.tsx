// When to show the notifications soft-ask (00 §4.4, PHASE_04 T4.2): once, a moment after the first masjid is followed,
// when onboarding is done, the person was never asked, the browser has not been answered yet, and push can be offered
// here (Android in any mode, iPhone only installed). The sheet itself is a lazy chunk.
import { lazy, Suspense, useEffect, useState } from 'react';

import { useDeviceSelector } from '../lib/data.tsx';
import { visibleFollows } from '../lib/device/store.ts';
import { pushPromptPossible } from '../lib/platform.ts';

const PushAskSheet = lazy(() => import('../features/settings/PushAskSheet.tsx'));

/** After the follow sheet has closed. */
const ASK_DELAY_MS = 1500;

export function PushAsk() {
  const due = useDeviceSelector(
    (state) =>
      state.onboardedAt !== undefined &&
      state.pushAskedAt === undefined &&
      state.push?.wanted !== true &&
      visibleFollows(state.follows).length > 0,
  );
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!due || !pushPromptPossible()) return;
    const timer = setTimeout(() => {
      setOpen(true);
    }, ASK_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [due]);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <PushAskSheet
        onClose={() => {
          setOpen(false);
        }}
      />
    </Suspense>
  );
}
