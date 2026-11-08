// The notifications soft-ask (00 §4.4, PHASE_04 T4.2): a sheet shown once, a moment after the first masjid is
// followed — Android in any mode, iPhone only inside the installed app. "Turn on" asks the browser (this tap is the
// gesture it needs); "Not now" is remembered, and Settings → Notifications still offers it. Lazy chunk.
import { useTranslation } from '@mc/i18n/react';
import { Button, IconCircle, Sheet } from '@mc/ui/components';
import { BellIcon } from '@mc/ui/icons';
import { useState } from 'react';

import { usePushControls } from './hooks/usePushControls.ts';

export default function PushAskSheet({ onClose }: { readonly onClose: () => void }) {
  const { t, ready } = useTranslation('settings');
  const push = usePushControls();
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    onClose();
  };
  const later = () => {
    void push.decline().finally(close);
  };
  if (!ready) return null;
  return (
    <Sheet
      open={open}
      onClose={later}
      title={t('push.askTitle')}
      footer={
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            loading={push.busy}
            onPress={() => {
              void push.enable().finally(close);
            }}
          >
            {t('push.askAllow')}
          </Button>
          <Button variant="ghost" fullWidth onPress={later}>
            {t('push.askLater')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center gap-4 pt-2 pb-4 text-center">
        <IconCircle size={56} tone="sun">
          <BellIcon size={28} />
        </IconCircle>
        <p className="type-body text-text-secondary">{t('push.intro')}</p>
      </div>
    </Sheet>
  );
}
