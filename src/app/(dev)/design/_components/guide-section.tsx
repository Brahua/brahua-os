type GuideSectionProps = {
  id: string;
  title: string;
  description?: string;
  children: React.ReactNode;
};

/** One section of the living style guide. `data-guide-section` is the screenshot target. */
export function GuideSection({ id, title, description, children }: GuideSectionProps) {
  const headingId = `${id}-heading`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-guide-section={id}
      className="flex flex-col gap-5 border-t border-border-subtle py-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="font-mono text-label text-text-muted uppercase">
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose text-body-sm text-text-muted">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Labeled cell used to lay out variants × states. */
export function Specimen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <span className="font-mono text-label-xs text-text-muted uppercase">{label}</span>
    </div>
  );
}
