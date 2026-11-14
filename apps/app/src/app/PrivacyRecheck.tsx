// The privacy notice again (05 §2, PHASE_08 T8.6): when the server's current version differs from the accepted one,
// or a year after acceptance. The decision needs `/config` (cached; offline it never prompts); the sheet is a lazy chunk.
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useState } from 'react';

import { configQuery } from '../lib/api/queries.ts';
import { useAppData, useDeviceSelector } from '../lib/data.tsx';
import { privacyRecheck } from '../lib/device/privacy-notice.ts';

const PrivacyNoticeSheet = lazy(() => import('../features/settings/PrivacyNoticeSheet.tsx'));

export function PrivacyRecheck() {
  const { api } = useAppData();
  const onboarded = useDeviceSelector((state) => state.onboardedAt !== undefined);
  const config = useQuery({ ...configQuery(api), enabled: onboarded });
  const serverVersion = config.data?.legalVersions.privacy;
  const reason = useDeviceSelector((state) => privacyRecheck(state, serverVersion, new Date()));
  // "Later" hides it until the next start (it comes back: the notice must be accepted to stay current).
  const [later, setLater] = useState(false);
  if (!reason || !serverVersion || later) return null;
  return (
    <Suspense fallback={null}>
      <PrivacyNoticeSheet
        reason={reason}
        version={serverVersion}
        onClose={() => {
          setLater(true);
        }}
      />
    </Suspense>
  );
}
