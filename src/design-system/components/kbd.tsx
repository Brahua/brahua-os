import { cn } from "@/lib/cn";

export type KbdTone = "default" | "signal" | "tooltip";

type KbdProps = Omit<React.ComponentProps<"kbd">, "children"> & {
  /** One key ("C") or a combination (["⌘", "K"]). */
  keys: string | string[];
  /** `signal` on an orange key, `tooltip` inside a tooltip. */
  tone?: KbdTone;
};

/** Engraved shortcut key (design system `Kbd`). */
export function Kbd({ keys, tone = "default", className, ...props }: KbdProps) {
  const list = ([] as string[]).concat(keys);
  const classes = cn(
    "bo-kbd",
    tone === "signal" && "bo-kbd--on-signal",
    tone === "tooltip" && "bo-kbd--on-tooltip",
    className,
  );

  if (list.length === 1) {
    return (
      <kbd className={classes} {...props}>
        {list[0]}
      </kbd>
    );
  }
  return (
    <kbd className="bo-kbd-group" {...props}>
      {list.map((key, i) => (
        <kbd key={`${key}-${i}`} className={classes}>
          {key}
        </kbd>
      ))}
    </kbd>
  );
}
