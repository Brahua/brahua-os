import Link from "next/link";
import { cn } from "@/lib/cn";

type RowContent = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Compact 44 px row for desktop lists (default: 64 px touch row). */
  compact?: boolean;
  /** Selected row: rendered as a raised key. */
  selected?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type ListRowProps = RowContent &
  (
    | ({ href: string } & Omit<React.ComponentProps<typeof Link>, "href" | "title" | "children">)
    | ({ href?: undefined; onClick: React.MouseEventHandler<HTMLButtonElement> } & Omit<
        React.ComponentProps<"button">,
        "title" | "children" | "onClick"
      >)
    | ({ href?: undefined; onClick?: undefined } & Omit<
        React.ComponentProps<"div">,
        "title" | "children"
      >)
  );

/**
 * Tappable row (design system `ListRow`): a Next.js link with `href`, a button with `onClick`,
 * otherwise a static row. Put rows inside `<div className="bo-list">` for the grouped look.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  compact = false,
  selected = false,
  className,
  children,
  ...props
}: ListRowProps) {
  const classes = cn("bo-row", compact && "bo-row--compact", selected && "is-selected", className);
  const content = (
    <>
      {leading}
      <span className="bo-row__body">
        <span className="bo-row__title">{title}</span>
        {subtitle ? <span className="bo-row__subtitle">{subtitle}</span> : null}
        {children}
      </span>
      {trailing ? <span className="bo-row__trail">{trailing}</span> : null}
    </>
  );

  if (props.href !== undefined) {
    return (
      <Link className={classes} aria-current={selected ? "true" : undefined} {...props}>
        {content}
      </Link>
    );
  }
  if (props.onClick !== undefined) {
    const { type, ...buttonProps } = props as React.ComponentProps<"button">;
    return (
      <button
        type={type ?? "button"}
        aria-pressed={selected || undefined}
        className={classes}
        {...buttonProps}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={classes} {...(props as React.ComponentProps<"div">)}>
      {content}
    </div>
  );
}
