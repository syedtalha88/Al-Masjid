import { createFileRoute } from '@tanstack/react-router';

import { HomeScreen } from '../features/home/HomeScreen.tsx';

/** A2 Home — Home tab root. */
export const Route = createFileRoute('/')({
  component: HomeScreen,
});
