// The Super Admin's switches as admins see them on Home (PHASE_08 T8.9): admin read-only mode — masjid admins are told
// changes wait (a Super Admin is never blocked; the C1 dashboard shows them the switch) — and the maintenance banner
// (both apps). From `/auth/me`, asked again every minute while read-only mode is on.
import { useLocale, useTranslation } from '@mc/i18n/react';
import { NoticeBanner } from '@mc/ui/components';

import { useSignedInAdmin } from '../../auth/hooks/use-session.ts';

export function AdminBanners({ className }: { readonly className?: string }) {
  const { t } = useTranslation('admin');
  const { locale } = useLocale();
  const me = useSignedInAdmin();
  const maintenance = me.maintenanceBanner?.[locale];
  const readOnly = me.readOnly && me.admin.role === 'masjid_admin';
  if (!maintenance && !readOnly) return null;
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      {readOnly ? <NoticeBanner tone="warning">{t('home.readOnly')}</NoticeBanner> : null}
      {maintenance ? <NoticeBanner tone="info">{maintenance}</NoticeBanner> : null}
    </div>
  );
}
