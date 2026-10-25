import { createFileRoute } from '@tanstack/react-router';

import { ItemDetailScreen } from '../features/content/ItemDetailScreen.tsx';

/** In-app item detail (`/items/:publicId`, 07 Navigation map) — notices, the hadith/ayah reader, dua requests. */
export const Route = createFileRoute('/items/$publicId')({
  component: ItemDetailScreen,
});
