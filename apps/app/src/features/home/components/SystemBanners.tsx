// The Super Admin's banners on Home (07 A17, PHASE_08 T8.9): an incident notice for every musalli, then the
// maintenance banner — from `/config` (cached 60 s at the edge and offline), in the reader's language.
import { useLocale } from '@mc/i18n/react';
import type { PublicConfig } from '@mc/shared/contracts/public';
import { NoticeBanner } from '@mc/ui/components';

export function SystemBanners({ config }: { readonly config: PublicConfig | undefined }) {
  const { locale } = useLocale();
  const incident = config?.incidentBanner?.[locale];
  const maintenance = config?.maintenanceBanner?.[locale];
  if (!incident && !maintenance) return null;
  return (
    <div className="flex flex-col gap-2 pb-4">
      {incident ? <NoticeBanner tone="danger">{incident}</NoticeBanner> : null}
      {maintenance ? <NoticeBanner tone="info">{maintenance}</NoticeBanner> : null}
    </div>
  );
}
