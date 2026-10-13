import { REVIEW_COPY } from "../review-copy";

/**
 * Steps 3 (Metas y proyectos) and 4 (Próxima semana) until W3 builds them. No date is promised.
 * W3 slot: replace this with the real steps in `src/app/(app)/review/page.tsx`.
 */
export function StepSoon() {
  return (
    <div className="flex max-w-160 flex-col gap-1" data-review-step="soon">
      <p className="bo-text-title">{REVIEW_COPY.soonTitle}</p>
      <p className="bo-text-body-sm text-text-secondary">{REVIEW_COPY.soonText}</p>
    </div>
  );
}
