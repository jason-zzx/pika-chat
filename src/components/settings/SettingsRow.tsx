import type { ReactNode } from "react";

type SettingsRowProps = {
  label: string;
  description?: string;
  control: ReactNode;
};

/**
 * Label-and-control row for inside a SettingsCard. Sibling rows are separated
 * with `divide-y` on the card, not borders here.
 */
export default function SettingsRow({
  label,
  description,
  control,
}: SettingsRowProps) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
