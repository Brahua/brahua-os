// What a change in `finance` revalidates (server only). Shared by the actions of `finance`.
import "server-only";
import { revalidatePath } from "next/cache";
import { HOME_PATH } from "@/lib/routes";
import { FINANCE_PATH } from "./routes";

/**
 * Every page under /finance (the month and, F2, each recurring payment's page). For changes the
 * home page doesn't show: a loose expense created or edited, a category, the rate.
 */
export function revalidateFinanceScreens() {
  revalidatePath(FINANCE_PATH, "layout");
}

/**
 * /finance and the home page, where `today` shows "Pagos" (F4, SPEC-today "Revalidación"): every
 * write of a recurring payment or of its periods (pay, skip and their undo, edit, archive,
 * reactivate, delete, restore), deleting or restoring an expense (a paid period's expense frees
 * or takes back its period) and the payment methods (their names show in the rows).
 */
export function revalidateFinanceAndHome() {
  revalidateFinanceScreens();
  revalidatePath(HOME_PATH);
}
