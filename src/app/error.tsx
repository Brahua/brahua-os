"use client";

import { ErrorScreen, type ErrorScreenProps } from "@/modules/core/components/error-screen";

/**
 * Errors outside the shell: the `(app)` layout itself (e.g. the session lookup when the database
 * is down), the login page and the root 404. Renders inside the root layout, so the theme and the
 * fonts still apply; only an error in the root layout reaches `global-error.tsx`.
 */
export default function RootError({ error, retry }: ErrorScreenProps) {
  return (
    <main className="flex flex-1 flex-col">
      <ErrorScreen error={error} retry={retry} />
    </main>
  );
}
