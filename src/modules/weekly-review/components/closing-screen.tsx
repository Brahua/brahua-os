import Link from "next/link";
import { Key } from "@/design-system";
import { HOME_PATH } from "@/lib/routes";
import { CIERRE_COPY } from "../review-copy";
import type { LogrosModel } from "../logros";
import { ClosingEffects } from "./closing-effects";
import { StepLogros } from "./step-logros";

type ClosingScreenProps = {
  headingId: string;
  model: LogrosModel;
  note: string | null;
  /** The objective of the next week, when there is one. */
  objective: string | null;
};

/**
 * The closing screen (SPEC-weekly-review "Pantallas"): what the week held (the figures of step 1),
 * the note and the next week's objective as the owner left them, and «Volver a Hoy». The ritual
 * ends on what was achieved, never on what is left.
 */
export function ClosingScreen({ headingId, model, note, objective }: ClosingScreenProps) {
  return (
    <div className="flex flex-col gap-6" data-review-closing="">
      <ClosingEffects headingId={headingId} />
      <h2 id={`${headingId}-step`} className="bo-text-title">
        {CIERRE_COPY.title}
      </h2>
      <p className="bo-text-body-sm text-text-secondary">{CIERRE_COPY.subtitle}</p>
      <StepLogros model={model} />
      {objective ? (
        <section className="flex max-w-160 flex-col gap-1" data-closing="objective">
          <h3 className="bo-text-label text-text-secondary">{CIERRE_COPY.objectiveTitle}</h3>
          <p className="bo-text-body break-words">{objective}</p>
        </section>
      ) : null}
      {note ? (
        <section className="flex max-w-160 flex-col gap-1" data-closing="note">
          <h3 className="bo-text-label text-text-secondary">{CIERRE_COPY.noteTitle}</h3>
          <p className="bo-text-body break-words whitespace-pre-line">{note}</p>
        </section>
      ) : null}
      <div>
        <Key asChild variant="signal">
          <Link href={HOME_PATH} data-review-home="">
            {CIERRE_COPY.backToToday}
          </Link>
        </Key>
      </div>
    </div>
  );
}
