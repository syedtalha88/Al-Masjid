import { createFileRoute } from '@tanstack/react-router';

import { CampaignsScreen } from '../features/campaigns/CampaignsScreen.tsx';

/** A10 Donation Campaigns of one masjid (PHASE_05 T5.4). */
export const Route = createFileRoute('/masjid_/$masjidId/campaigns')({
  component: CampaignsScreen,
});
