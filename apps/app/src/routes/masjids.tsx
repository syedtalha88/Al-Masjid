import { createFileRoute } from '@tanstack/react-router';

import { MyMasjidsScreen } from '../features/masjids/MyMasjidsScreen.tsx';

/** A3 My Masjids — tab root. */
export const Route = createFileRoute('/masjids')({
  component: MyMasjidsScreen,
});
