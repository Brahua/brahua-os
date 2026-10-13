import Link from "next/link";
import { Key } from "@/design-system";
import { cn } from "@/lib/cn";
import { REVIEW_COPY } from "../review-copy";
import { REVIEW_STEPS, reviewStepPath, type ReviewStep } from "../routes";
import { weekLabel } from "../week";

type ReviewShellProps = {
  /** Id of the page's `<h1 tabIndex={-1}>`. */
  headingId: string;
  /** The Monday of the week under review. */
  weekStart: string;
  step: ReviewStep;
  /** The week in progress, when the page shows another one: offers «Ver esta semana». */
  currentWeek?: string | null;
  /** The closing screen: no steps, no «Atrás» / «Seguir» (the ritual is over). */
  closing?: boolean;
  children: React.ReactNode;
};

/**
 * The frame of every step (SPEC-weekly-review "Pantallas"): the week as the heading, the four
 * steps as plain links (`aria-current="step"` on the one shown: leaving and coming back loses
 * nothing, there is no client state), the step's own content and «Atrás» / «Seguir». The layout
 * does not move between steps: «Atrás» keeps its cell on the first step (empty) and «Seguir» on
 * the last, where the step's own key «Cerrar la semana» takes its place. The closing screen
 * (`closing`) keeps only the heading and the content.
 */
export function ReviewShell({
  headingId,
  weekStart,
  step,
  currentWeek,
  closing = false,
  children,
}: ReviewShellProps) {
  const last = REVIEW_STEPS[REVIEW_STEPS.length - 1];
  const previous = step > 1 ? ((step - 1) as ReviewStep) : null;
  const following = step < last ? ((step + 1) as ReviewStep) : null;
  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
      <header className="flex flex-col gap-1">
        <p className="bo-text-label text-text-secondary">{REVIEW_COPY.pageTitle}</p>
        <h1 id={headingId} tabIndex={-1} className="bo-text-display outline-none">
          {weekLabel(weekStart)}
        </h1>
        {currentWeek ? (
          <p>
            <Link
              href={reviewStepPath(step, currentWeek)}
              className="bo-text-body-sm rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {REVIEW_COPY.viewCurrentWeek}
            </Link>
          </p>
        ) : null}
      </header>

      {closing ? (
        <section aria-labelledby={`${headingId}-step`} className="flex flex-col gap-5">
          {children}
        </section>
      ) : (
        <>
          <nav aria-label={REVIEW_COPY.stepsNav}>
            <ol className="grid grid-cols-4 gap-2" data-review-steps="">
              {REVIEW_STEPS.map((number) => {
                const current = number === step;
                return (
                  <li key={number} className="min-w-0">
                    <Link
                      href={reviewStepPath(number, weekStart)}
                      aria-current={current ? "step" : undefined}
                      data-step={number}
                      className={cn(
                        "flex min-h-11 flex-col justify-center gap-0.5 rounded-md border-t-2 px-1 pt-2 pb-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                        current ? "border-signal" : "border-divider text-text-secondary",
                      )}
                    >
                      <span className="bo-text-label">{number}</span>
                      <span className="bo-text-body-sm truncate">
                        {REVIEW_COPY.steps[number - 1]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>

          <section aria-labelledby={`${headingId}-step`} className="flex min-h-64 flex-col gap-5">
            <h2 id={`${headingId}-step`} className="bo-text-title">
              <span className="sr-only">
                {REVIEW_COPY.stepPosition(step, REVIEW_STEPS.length)}.{" "}
              </span>
              {REVIEW_COPY.steps[step - 1]}
            </h2>
            {children}
          </section>

          <div className="flex items-center justify-between gap-3">
            {previous ? (
              <Key asChild variant="ghost">
                <Link href={reviewStepPath(previous, weekStart)} data-review-back="">
                  {REVIEW_COPY.back}
                </Link>
              </Key>
            ) : (
              <span aria-hidden />
            )}
            {following ? (
              <Key asChild variant="signal">
                <Link href={reviewStepPath(following, weekStart)} data-review-next="">
                  {REVIEW_COPY.next}
                </Link>
              </Key>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
