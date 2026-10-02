// Validation and copy of the next action (T5, SPEC-tasks "Próxima acción"). Client-safe.
import { z } from "zod";
import { TASK_ERRORS } from "./task-input";

export const NEXT_ACTION_ERRORS = {
  withoutProject: "Solo una tarea de un proyecto puede ser su próxima acción.",
  done: "Una tarea hecha no puede ser la próxima acción.",
  projectClosed:
    "Ese proyecto ya no está abierto (se terminó, se canceló o se eliminó): no puede tener próxima acción.",
  moved: "La tarea cambió de proyecto mientras tanto. Vuelve a intentarlo.",
  next: "Elige si es la próxima acción.",
} as const;

/** Mark (`next: true`) or unmark a task as its project's next action. */
export const setNextActionInputSchema = z.object({
  id: z.uuid({ error: TASK_ERRORS.notFound }),
  next: z.boolean({ error: NEXT_ACTION_ERRORS.next }),
});

export type SetNextActionInput = z.output<typeof setNextActionInputSchema>;
