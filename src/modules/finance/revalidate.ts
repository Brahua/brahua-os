// What a change in `finance` revalidates (server only). Shared by the actions of `finance`.
import "server-only";
import { revalidatePath } from "next/cache";
import { FINANCE_PATH } from "./routes";

/**
 * Every page under /finance (the month and, F2, each recurring payment's page). F4 adds the home
 * page here when `today` shows "Pagos".
 */
export function revalidateFinanceScreens() {
  revalidatePath(FINANCE_PATH, "layout");
}
