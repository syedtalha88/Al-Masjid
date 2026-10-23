// Masjid preview sheet (07 A4): what was scanned or typed → "Follow masjid" / "Cancel". Already following → "Open";
// at the 20-masjid limit (00 §4.1) → explain and offer My Masjids. A follow plays the success check (08 §5.8), then
// the caller opens Masjid Detail.
import { useTranslation } from '@mc/i18n/react';
import type { MasjidSummary } from '@mc/shared/contracts/public';
import { Button, Sheet } from '@mc/ui/components';
import { useState } from 'react';

import { FollowActions, FollowNotes } from './FollowActions.tsx';
import { MasjidPreview } from './MasjidPreview.tsx';
import { useFollowFlow } from './useFollowFlow.ts';

export interface FollowSheetProps {
  /** The masjid to preview; the sheet is open while set. */
  readonly masjid: MasjidSummary | null;
  readonly onClose: () => void;
  /** Followed (after the success check) or "Open" on one already followed: show that masjid. */
  readonly onOpen: (masjidId: string) => void;
  /** At the limit: "Open My Masjids". */
  readonly onManage: () => void;
}

export function FollowSheet({ masjid, onClose, onOpen, onManage }: FollowSheetProps) {
  const { t } = useTranslation('follow');
  const { t: tc } = useTranslation();
  // The masjid shown last, so the content stays while the sheet animates out.
  const [shown, setShown] = useState(masjid);
  const flow = useFollowFlow(shown?.id ?? null, onOpen);
  if (masjid && masjid !== shown) {
    setShown(masjid);
    flow.reset();
  }

  const footer =
    shown && flow.phase !== 'followed' && flow.phase !== 'opened' ? (
      <div className="flex flex-col gap-2">
        <FollowActions masjid={shown} flow={flow} onOpen={onOpen} onManage={onManage} />
        <Button variant="ghost" fullWidth onPress={onClose}>
          {tc('ui.cancel')}
        </Button>
      </div>
    ) : null;

  return (
    <Sheet open={masjid !== null} onClose={onClose} title={t('landing.title')} footer={footer}>
      {shown ? (
        <div className="flex flex-col gap-4 pb-2">
          <MasjidPreview masjid={shown} />
          <FollowNotes masjid={shown} flow={flow} />
        </div>
      ) : null}
    </Sheet>
  );
}
