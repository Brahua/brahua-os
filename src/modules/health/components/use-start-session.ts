"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HEALTH_COPY } from "../health-copy";
import { sessionPath } from "../routes";
import { startHealthSession } from "../sessions-actions";
import { SESSION_ERRORS, SESSIONS_COPY as COPY } from "../sessions-copy";
import { failureReason, useHealthSave } from "./use-health-save";

/**
 * «Empezar» (a routine, or free): starts and opens the session. With one already open nothing
 * starts: «Ya tienes un entreno en curso» with «Seguir». `busy` while it is on its way (keys use
 * `aria-disabled`, and `start` ignores a second tap).
 */
export function useStartSession() {
  const router = useRouter();
  const { send, toaster } = useHealthSave();
  const [busy, setBusy] = useState(false);

  async function start(routineId: string | null) {
    if (busy) return;
    setBusy(true);
    const result = await send(() => startHealthSession({ routineId }));
    if (!result.ok) {
      setBusy(false);
      toaster.push({
        title: HEALTH_COPY.notSavedTitle,
        text: `${COPY.notSaved.start} ${failureReason(result)}`,
        tone: "error",
      });
      return;
    }
    const data = result.data;
    if (data.started) {
      router.push(sessionPath(data.id));
      return;
    }
    setBusy(false);
    toaster.push({
      title: COPY.alreadyOpenTitle,
      text: SESSION_ERRORS.alreadyOpen,
      action: { label: COPY.resume, run: () => router.push(sessionPath(data.openId)) },
    });
  }

  return { start, busy };
}
