// iOS-style grouped list (07 A15): white rounded cards on the canvas, hairlines between rows, inset under the icons.
import { Divider, IconCircle, ListRow, type Tone } from '@mc/ui/components';
import { Fragment, type ReactNode } from 'react';

export interface SettingsRow {
  readonly key: string;
  readonly icon: ReactNode;
  readonly tone?: Tone;
  readonly title: string;
  readonly subtitle?: string;
  /** Current value ("English", "Installed", "Coming soon"). */
  readonly value?: ReactNode;
  /** Without it the row is static (no chevron, not a button). */
  readonly onPress?: () => void;
  /** A control instead of the row (e.g. the Vibration switch). */
  readonly custom?: ReactNode;
}

export function SettingsGroup({ rows, label }: { readonly rows: readonly SettingsRow[]; readonly label?: string }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={label} className="overflow-hidden rounded-md bg-surface shadow-e1">
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 ? <Divider inset="icon" /> : null}
          {row.custom ?? (
            <ListRow
              className="px-4"
              leading={
                <IconCircle size={44} tone={row.tone ?? 'primary'}>
                  {row.icon}
                </IconCircle>
              }
              title={row.title}
              {...(row.subtitle ? { subtitle: row.subtitle } : {})}
              {...(row.value === undefined
                ? {}
                : { trailing: <span className="type-callout text-text-secondary">{row.value}</span> })}
              {...(row.onPress ? { onPress: row.onPress } : { chevron: false })}
            />
          )}
        </Fragment>
      ))}
    </section>
  );
}
