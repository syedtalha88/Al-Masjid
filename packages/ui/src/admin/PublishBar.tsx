import { Button } from '../components/Button.tsx';
import { Switch } from '../components/Toggles.tsx';

export interface PublishBarProps {
  /** "Notify followers" — omit `notify` for actions that never notify. */
  readonly notify?: {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
    readonly label: string;
    /** Today's quota under the switch ("6 of 8 left today"); `undefined` while it loads. */
    readonly quota?: string | undefined;
    /** No notifications left today (Phase 4 asks before publishing without one). */
    readonly disabled?: boolean;
  };
  /** "Publish" / "Save timings". */
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** Publishing: the button shows its spinner and ignores presses. */
  readonly busy?: boolean;
  /** Nothing to publish yet (missing required fields). */
  readonly disabled?: boolean;
}

/**
 * The sticky bottom bar of every publish step (06 §6 admin, 07 B4–B7): the "Notify followers" switch with today's quota
 * and one big primary button. Sits above the safe area; the content scrolls under it.
 */
export function PublishBar({ notify, actionLabel, onAction, busy = false, disabled = false }: PublishBarProps) {
  return (
    <div className="sticky bottom-0 z-10 mx-bleed flex flex-col gap-3 bg-surface px-screen pt-3 pb-safe shadow-e2">
      {notify ? (
        <Switch
          checked={notify.checked}
          onChange={notify.onChange}
          label={notify.label}
          description={notify.quota}
          disabled={notify.disabled ?? false}
        />
      ) : null}
      <Button size="lg" fullWidth loading={busy} disabled={disabled} onPress={onAction} className="mb-3">
        {actionLabel}
      </Button>
    </div>
  );
}
