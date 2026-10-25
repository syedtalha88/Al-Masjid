import { createFileRoute } from '@tanstack/react-router';

import { PostLandingScreen } from '../features/content/PostLanding.tsx';

/** A16 post landing (`/p/:publicId`): the post read-only + Follow + get the app. */
export const Route = createFileRoute('/p/$publicId')({
  component: PostLandingScreen,
});
