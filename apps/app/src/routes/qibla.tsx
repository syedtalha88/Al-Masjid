import { createFileRoute } from '@tanstack/react-router';

import { QiblaScreen } from '../features/qibla/QiblaScreen.tsx';

/** A14 Qibla — full-screen from the Home header (PHASE_07, DECISIONS #118). */
export const Route = createFileRoute('/qibla')({
  component: QiblaScreen,
});
