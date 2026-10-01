import type { Metadata } from "next";
import { NotFoundScreen } from "@/modules/core/components/not-found-screen";
import { STATUS_COPY } from "@/modules/core/copy";

export const metadata: Metadata = {
  title: STATUS_COPY.notFound.title,
  robots: { index: false, follow: false },
};

/**
 * `notFound()` from a signed-in page (e.g. an item that does not exist): renders inside the shell,
 * below the `(app)` layout, which already checked the session. Unknown URLs use the root
 * `not-found.tsx`.
 */
export default function AppNotFound() {
  return <NotFoundScreen signedIn />;
}
