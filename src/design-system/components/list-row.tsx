import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { cn } from "@/lib/cn";

const listRowVariants = cva(
  [
    "flex w-full items-center gap-3 border-t border-border-subtle px-3.5 text-left text-text",
    "cursor-pointer transition-colors duration-hover",
    "hover:bg-surface-hover active:bg-surface",
    "disabled:cursor-not-allowed disabled:opacity-50",
  ],
  {
    variants: {
      /** `touch` for phones (56px); `fine` for dense desktop lists (40px). */
      density: { touch: "min-h-14 py-2.5", fine: "min-h-10 py-1.5" },
    },
    defaultVariants: { density: "touch" },
  },
);

type RowContentProps = {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
};

type ListRowProps = VariantProps<typeof listRowVariants> &
  RowContentProps & { className?: string } & (
    | ({ href: string } & Omit<React.ComponentProps<typeof Link>, "href" | "children">)
    | ({ href?: undefined } & Omit<React.ComponentProps<"button">, "children">)
  );

function RowContent({ leading, trailing, description, children }: RowContentProps) {
  return (
    <>
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body">{children}</span>
        {description ? (
          <span className="truncate font-mono text-label-xs text-text-muted uppercase">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center gap-2">{trailing}</span> : null}
    </>
  );
}

/**
 * Tappable list row with a top divider, optional leading/trailing slots and a description.
 * With `href` it renders a Next.js link; otherwise a button.
 */
export function ListRow({
  density,
  leading,
  trailing,
  description,
  className,
  children,
  ...props
}: ListRowProps) {
  const classes = cn(listRowVariants({ density }), className);
  const content = (
    <RowContent leading={leading} trailing={trailing} description={description}>
      {children}
    </RowContent>
  );

  if (props.href !== undefined) {
    return (
      <Link className={classes} {...props}>
        {content}
      </Link>
    );
  }

  const { type, ...buttonProps } = props;
  return (
    <button type={type ?? "button"} className={classes} {...buttonProps}>
      {content}
    </button>
  );
}
