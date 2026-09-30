import { cn } from "@/lib/cn";

type SectionLabelProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title: React.ReactNode;
  /** Counter on the right, e.g. "2/6". */
  count?: React.ReactNode;
  /** Title in the signal color (e.g. "HOY"). */
  signal?: boolean;
  /** Use a heading level when the label names a page section. */
  as?: "div" | "h2" | "h3" | "h4";
};

/** Mono uppercase section label with a counter on the right (design system `SectionLabel`). */
export function SectionLabel({
  title,
  count,
  signal = false,
  as: Comp = "div",
  className,
  ...props
}: SectionLabelProps) {
  return (
    <Comp
      className={cn("bo-section-label", signal && "bo-section-label--signal", className)}
      {...props}
    >
      <span className="bo-section-label__title">{title}</span>
      {count != null ? <span className="bo-section-label__count">{count}</span> : null}
    </Comp>
  );
}
