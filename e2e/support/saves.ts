import { expect, type Page } from "@playwright/test";
import { animationsSettled } from "./animations";

/**
 * Waits until the page has settled after a save, before measuring it (axe, screenshots):
 *
 * 1. No section is saving: sections mark themselves `data-saving` while a save's transition is
 *    pending (e.g. the milestones), so the optimistic view has been replaced by the server's.
 * 2. The document has its title again: right after a Server Action's revalidation Next can swap
 *    the tree with the <title> briefly missing (seen in CI as axe's `document-title`).
 * 3. No CSS transition or animation is running (`animationsSettled`).
 */
export async function afterSaveSettled(page: Page) {
  await expect(page.locator("[data-saving]")).toHaveCount(0);
  await expect(page).toHaveTitle(/ · brahua-os$/);
  await animationsSettled(page);
}
