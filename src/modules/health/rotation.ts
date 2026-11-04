// «La que toca» (SPEC-health "Rotación"): the live routine whose last finished session is the
// oldest; the never-done ones first, in their order. No calendar. Client-safe and pure.

export type RotationRoutine = {
  id: string;
  name: string;
  position: number;
  /** ISO instant its latest finished, live session started, or null when never done. */
  lastDoneAt: string | null;
};

function comesBefore(a: RotationRoutine, b: RotationRoutine): boolean {
  if ((a.lastDoneAt === null) !== (b.lastDoneAt === null)) return a.lastDoneAt === null;
  if (a.lastDoneAt !== null && b.lastDoneAt !== null) {
    const diff = Date.parse(a.lastDoneAt) - Date.parse(b.lastDoneAt);
    if (diff !== 0) return diff < 0;
  }
  return a.position < b.position;
}

/** The routine that comes next, or null without routines. */
export function nextRoutine<T extends RotationRoutine>(routines: readonly T[]): T | null {
  let best: T | null = null;
  for (const routine of routines) {
    if (best === null || comesBefore(routine, best)) best = routine;
  }
  return best;
}
