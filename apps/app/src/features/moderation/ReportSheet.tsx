// The report sheet (00 §4.7, 05 §3, PHASE_08 T8.1): one of seven reasons (big cards — no typing needed), optional
// details (≤ 500), Send; then "Thank you" — the masjid never learns who reported. Loaded lazily from the "…" menus
// (item detail, bayan player, dua request, donation drive, Masjid Detail), so none of it is in the first load.
import { useTranslation } from '@mc/i18n/react';
import { REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from '@mc/shared/compliance';
import { Button, RadioCardGroup, Sheet, TextArea } from '@mc/ui/components';
import { CheckCircleIcon, WarningIcon } from '@mc/ui/icons';
import { useState } from 'react';

import { type ReportProblem, type ReportTarget, useReport } from './hooks/useReport.ts';

export interface ReportSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly target: ReportTarget;
}

const PROBLEM_KEY = {
  offline: 'report.offline',
  limit: 'report.limit',
  gone: 'report.gone',
  failed: 'report.failed',
} as const satisfies Readonly<Record<ReportProblem, string>>;

export default function ReportSheet({ open, onClose, target }: ReportSheetProps) {
  const { t } = useTranslation();
  const { state, send, reset } = useReport(target);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const sent = state.status === 'sent';

  const close = () => {
    onClose();
    if (sent) {
      reset();
      setReason(null);
      setDetails('');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title={sent ? t('report.thanksTitle') : t(target.kind === 'item' ? 'report.titlePost' : 'report.titleMasjid')}
      snaps={sent ? ['content'] : ['full']}
      footer={
        sent ? (
          <Button size="lg" fullWidth onPress={close}>
            {t('report.done')}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Right above Send, so it is seen without scrolling. */}
            {state.status === 'error' ? (
              <p
                className="flex items-start gap-2 type-callout text-danger"
                role="alert"
                data-report-error={state.problem}
              >
                <WarningIcon size={20} className="mt-0.5 shrink-0" />
                {t(PROBLEM_KEY[state.problem])}
              </p>
            ) : null}
            <Button
              size="lg"
              fullWidth
              disabled={reason === null}
              loading={state.status === 'sending'}
              onPress={() => {
                if (reason) void send(reason, details);
              }}
            >
              {state.status === 'sending' ? t('report.sending') : t('report.send')}
            </Button>
          </div>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 pt-2 pb-4 text-center" data-report-sent>
          <CheckCircleIcon size={48} className="text-primary-500" />
          <p className="type-body text-text-secondary">{t('report.thanksBody')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 pb-4" data-report-form>
          <RadioCardGroup
            legend={t('report.reasonLegend')}
            name="report-reason"
            value={reason}
            onChange={setReason}
            options={REPORT_REASONS.map((value) => ({
              value,
              title: t(`report.reason.${value}`),
              ...(value === 'private_info' ? { description: t('report.privateInfoHint') } : {}),
            }))}
          />
          <TextArea
            label={t('report.details')}
            optional
            hint={t('report.detailsHint')}
            maxLength={REPORT_DETAILS_MAX}
            value={details}
            onChange={(event) => {
              setDetails(event.target.value);
            }}
          />
        </div>
      )}
    </Sheet>
  );
}
