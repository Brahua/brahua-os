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
      className="flex flex-col gap-5 border-t border-divider py-8"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="bo-text-heading">
          {title}
        </h2>
        {description ? (
          <p className="max-w-prose bo-text-body-sm text-text-secondary">{description}</p>
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
      <span className="bo-text-label text-text-secondary">{label}</span>
    </div>
  );
}
