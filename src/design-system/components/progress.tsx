import { cn } from "@/lib/cn";

type ProgressRingProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** 0–100 */
  value: number;
  size?: "sm" | "md" | "lg";
  /** Small caption under the number (hidden on `sm`). */
  caption?: string;
  /** Accessible name. */
  label?: string;
};

/** Day progress ring (design system `ProgressRing`, conic-gradient). Meant to live inside an Lcd. */
export function ProgressRing({
  value,
  size = "md",
  caption = "% DÍA",
  label = "Progreso del día",
  className,
  style,
  ...props
}: ProgressRingProps) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label}
      className={cn("bo-ring", size !== "md" && `bo-ring--${size}`, className)}
      style={{ "--value": v, ...style } as React.CSSProperties}
      {...props}
    >
      <div className="bo-ring__hole" aria-hidden>
        <span className="bo-ring__value">{v}</span>
        {caption && size !== "sm" ? <span className="bo-ring__caption">{caption}</span> : null}
      </div>
    </div>
  );
}

type SegmentBarProps = Omit<React.ComponentProps<"div">, "children"> & {
  total: number;
  filled?: number;
  /** Outline the next segment in signal color. */
  next?: boolean;
  size?: "md" | "lg";
  /** Accessible name; defaults to "N de total". */
  label?: string;
};

/** Goal in segments, one per unit (design system `SegmentBar`). */
export function SegmentBar({
  total,
  filled = 0,
  next = false,
  size = "md",
  label,
  className,
  style,
  ...props
}: SegmentBarProps) {
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={filled}
      aria-label={label ?? `${filled} de ${total}`}
      className={cn("bo-segbar", size === "lg" && "bo-segbar--lg", className)}
      style={{ "--n": total, ...style } as React.CSSProperties}
      {...props}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "bo-segbar__seg",
            i < filled && "is-filled",
            next && i === filled && "is-next",
          )}
        />
      ))}
    </div>
  );
}

export type DotMatrixDay = {
  /** Short label shown under the dots ("L", "M"…). */
  label: string;
  /** Full name for screen readers ("lunes 28"). Defaults to `label`. */
  name?: string;
  done?: number;
  total?: number;
  /** Every item done: dots turn signal orange. */
  complete?: boolean;
  state?: "past" | "today" | "upcoming";
};

type DotMatrixProps = Omit<React.ComponentProps<"div">, "children"> & {
  days: DotMatrixDay[];
  dotSize?: number;
  /** Accessible name of the whole week. */
  label?: string;
};

/** Week as a 7 × (3×3) dot matrix (design system `DotMatrix`). Meant to live inside an Lcd. */
export function DotMatrix({
  days,
  dotSize = 6,
  label = "Semana",
  className,
  style,
  ...props
}: DotMatrixProps) {
  return (
    <div
      role="list"
      aria-label={label}
      className={cn("bo-dotmatrix", className)}
      style={{ "--_d": `${dotSize}px`, ...style } as React.CSSProperties}
      {...props}
    >
      {days.map((day, i) => {
        const total = day.total ?? 9;
        const done = day.done ?? 0;
        return (
          <div
            key={i}
            role="listitem"
            aria-label={`${day.name ?? day.label}${day.state === "today" ? " (hoy)" : ""}: ${done} de ${total}`}
            className={cn(
              "bo-dotmatrix__day",
              day.state === "today" && "is-today",
              day.state === "upcoming" && "is-upcoming",
            )}
          >
            <div className="bo-dotmatrix__grid" aria-hidden>
              {Array.from({ length: total }, (_, j) => (
                <span
                  key={j}
                  className={cn("bo-dot", j < done && (day.complete ? "is-complete" : "is-done"))}
                />
              ))}
            </div>
            <span className="bo-dotmatrix__label" aria-hidden>
              {day.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export type DayState = "done" | "rest" | "today" | "upcoming";

const DAY_TEXT: Record<DayState, string> = {
  done: "hecho",
  rest: "descanso",
  today: "hoy, pendiente",
  upcoming: "por venir",
};

type DayCellProps = Omit<React.ComponentProps<"span">, "children"> & {
  state?: DayState;
  /** Mark today's cell (signal ring). */
  today?: boolean;
  size?: "md" | "lg";
  /** Day name for screen readers ("jueves 24"). */
  label?: string;
};

/** A habit's day (design system `DayCell`). Rest is a valid state: grey dash, never red. */
export function DayCell({
  state = "rest",
  today = false,
  size = "md",
  label,
  className,
  ...props
}: DayCellProps) {
  const text = today && state === "done" ? "hoy, hecho" : DAY_TEXT[state];
  return (
    <span
      role="img"
      aria-label={label ? `${label}: ${text}` : text}
      className={cn(
        "bo-daycell",
        size === "lg" && "bo-daycell--lg",
        `is-${state}`,
        today && "is-today",
        className,
      )}
      {...props}
    />
  );
}
