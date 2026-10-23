import { createFileRoute } from '@tanstack/react-router';

import { ScanScreen } from '../features/follow/ScanScreen.tsx';

/** A4 Scan — full-screen modal (`?enter=code` opens the code sheet at once: onboarding "Enter code"). */
export const Route = createFileRoute('/scan')({
  component: ScanScreen,
});
