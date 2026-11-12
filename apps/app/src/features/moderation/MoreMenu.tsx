// The "…" button of the detail screens (00 §4.7: every post, video, dua request and donation drive): a small options
// sheet whose only entry for now is "Report"; the report sheet itself loads on demand.
import { useTranslation } from '@mc/i18n/react';
import { Button, IconButton, Sheet } from '@mc/ui/components';
import { DotsIcon, WarningIcon } from '@mc/ui/icons';
import { lazy, Suspense, useState } from 'react';

import type { ReportTarget } from './hooks/useReport.ts';

const ReportSheet = lazy(() => import('./ReportSheet.tsx'));

export function MoreMenu({ target }: { readonly target: ReportTarget }) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  return (
    <>
      <IconButton
        label={t('report.more')}
        icon={<DotsIcon />}
        onPress={() => {
          setMenu(true);
        }}
        data-more-menu
      />
      <Sheet
        open={menu}
        onClose={() => {
          setMenu(false);
        }}
        title={t('report.menuTitle')}
      >
        <div className="flex flex-col gap-2 pb-2">
          <Button
            variant="secondary"
            fullWidth
            leadingIcon={<WarningIcon />}
            onPress={() => {
              setMenu(false);
              setReport(true);
            }}
            data-report-open
          >
            {t('report.action')}
          </Button>
        </div>
      </Sheet>
      <ReportSheetOnDemand
        open={report}
        target={target}
        onClose={() => {
          setReport(false);
        }}
      />
    </>
  );
}

/** Loads the report sheet the first time it is opened, then keeps it mounted so it can animate closed. */
export function ReportSheetOnDemand(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly target: ReportTarget;
}) {
  const [wanted, setWanted] = useState(props.open);
  if (props.open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <ReportSheet {...props} />
    </Suspense>
  );
}
