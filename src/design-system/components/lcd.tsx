import { cn } from "@/lib/cn";
import { Led } from "./led";

type LcdProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** Mono tag on the left ("HOY"). */
  tag?: React.ReactNode;
  /** Mono metadata on the right. */
  meta?: React.ReactNode;
  /** Free-form LCD panel instead of a single-line strip. */
  block?: boolean;
  /** Orange strip for celebrations. */
  signal?: boolean;
  /** Signal LED before the tag. */
  led?: boolean;
  /** Announce content changes to screen readers (status messages). */
  live?: boolean;
  children?: React.ReactNode;
};

/** LCD strip for status messages (design system `Lcd`). `block` = LCD panel with free content. */
export function Lcd({
  tag,
  meta,
  block = false,
  signal = false,
  led = true,
  live = !block,
  className,
  children,
  ...props
}: LcdProps) {
  return (
    <div
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      className={cn("bo-lcd", block && "bo-lcd--block", signal && "bo-lcd--signal", className)}
      {...props}
    >
      {block ? (
        children
      ) : (
        <>
          {tag ? (
            <span className="bo-lcd__tag">
              {led && !signal ? <Led signal on size="sm" /> : null}
              {tag}
            </span>
          ) : null}
          <span className="bo-lcd__text">{children}</span>
          {meta ? <span className="bo-lcd__meta">{meta}</span> : null}
        </>
      )}
    </div>
  );
}

type ToastProps = Omit<React.ComponentProps<"div">, "children" | "title"> & {
  title: React.ReactNode;
  text: React.ReactNode;
  actionLabel?: string;
  /** Omit to hide the action button. */
  onAction?: () => void;
  /** Extra attributes for the action button (e.g. `aria-keyshortcuts`). */
  actionProps?: Omit<React.ComponentProps<"button">, "onClick" | "children" | "type">;
  /**
   * Be its own live region (default). Turn it off when a toaster renders it inside a region
   * that is always there: a region that appears with its content is often not announced.
   */
  live?: boolean;
};

/** Floating LCD-style notice with an Undo action (design system `Toast`). */
export function Toast({
  title,
  text,
  actionLabel = "Deshacer",
  onAction,
  actionProps,
  live = true,
  className,
  ...props
}: ToastProps) {
  return (
    <div
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      className={cn("bo-toast", className)}
      {...props}
    >
      <Led signal on />
      <div className="bo-toast__body">
        <span className="bo-lcd__tag">{title}</span>
        <span className="bo-toast__text">{text}</span>
      </div>
      {onAction ? (
        <button
          type="button"
          {...actionProps}
          className={cn("bo-toast__action", actionProps?.className)}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
