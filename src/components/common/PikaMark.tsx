import { cn } from "@/lib/utils";

/** Brand fills for the in-page mark. The app icon keeps its own field. */
const EYE = "#35564A";
const FUR = "#F6E4C8";
const INNER_EAR = "#C97B56";

type PikaMarkProps = {
  className?: string;
};

export default function PikaMark({ className }: PikaMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("size-8 shrink-0", className)}
      aria-hidden="true"
    >
      <g fill={FUR}>
        <circle cx="10.4" cy="8.2" r="5.15" />
        <circle cx="21.6" cy="8.2" r="5.15" />
        <rect x="4.6" y="10.4" width="22.8" height="14.6" rx="7.3" />
        <path d="M9.2 22.8C6.4 25.6 4.15 28.7 4.2 30.55c.02.55.62.88 1.1.62 1.95-1.05 3.85-2.7 5.55-4.35.5-.48.58-1.25.18-1.78L10.3 23.2c-.28-.38-.78-.4-1.1-.4z" />
      </g>
      <circle cx="10.4" cy="7.55" r="2.35" fill={INNER_EAR} />
      <circle cx="21.6" cy="7.55" r="2.35" fill={INNER_EAR} />
      <circle cx="12.15" cy="16.6" r="1.55" fill={EYE} />
      <circle cx="19.85" cy="16.6" r="1.55" fill={EYE} />
    </svg>
  );
}
