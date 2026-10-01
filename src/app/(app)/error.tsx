"use client";

import { ErrorScreen, type ErrorScreenProps } from "@/modules/core/components/error-screen";

/**
 * Errors in the signed-in pages render here, inside the shell: the navigation stays usable. An
 * error in the `(app)` layout itself is not caught here (a segment's error boundary sits below
 * its layout): that one goes to the root `error.tsx`.
 */
export default function AppError({ error, retry }: ErrorScreenProps) {
  return <ErrorScreen error={error} retry={retry} />;
}
