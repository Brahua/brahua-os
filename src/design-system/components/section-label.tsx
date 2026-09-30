import { cn } from "@/lib/cn";

type SectionLabelProps = React.HTMLAttributes<HTMLElement> & {
  as?: "h2" | "h3" | "h4" | "p" | "span";
  /** Optional counter shown after a middle dot, e.g. "2/6" → "HÁBITOS · 2/6". */
  count?: string;
  size?: "xs" | "sm";
};

/** Mono, uppercase section label. Renders an h2 by default so sections stay navigable. */
export function SectionLabel({
  as: Comp = "h2",
  count,
  size = "sm",
  className,
  children,
  ...props
}: SectionLabelProps) {
  return (
    <Comp
      className={cn(
        "m-0 font-mono text-text-muted uppercase",
        size === "xs" ? "text-label-xs" : "text-label",
        className,
      )}
      {...props}
    >
      {children}
      {count ? (
        <>
          <span aria-hidden> · </span>
          <span className="text-text">
            <span className="sr-only">, </span>
            {count}
          </span>
        </>
      ) : null}
    </Comp>
  );
}
