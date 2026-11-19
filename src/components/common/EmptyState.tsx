type EmptyStateProps = {
  title: string;
  description: string;
};

export default function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-10 text-center">
      <p className="text-base font-medium md:text-sm">{title}</p>
      <p className="max-w-md text-base text-muted-foreground md:text-sm">{description}</p>
    </div>
  );
}
