import { useTranslation } from '@mc/i18n/react';
import { Tag, type Tone } from '@mc/ui/components';

import type { LibraryStatus } from '../api/super-api.ts';

const TONE: Readonly<Record<LibraryStatus, Tone>> = { draft: 'sun', verified: 'primary', retired: 'neutral' };

/** Content Library entry status as a colored tag (C8). */
export function LibraryStatusTag({ status }: { readonly status: LibraryStatus }) {
  const { t } = useTranslation('super');
  return <Tag tone={TONE[status]}>{t(`library.statuses.${status}`)}</Tag>;
}
