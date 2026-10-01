// C6: reorder (buttons and keyboard drag), archive, undo and unarchive life areas.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  archivedList,
  archivedToggle,
  createArea,
  editRows,
  expect,
  isDesktop,
  list,
  newAreaButton,
  notices,
  openAreas,
  rowIndex,
  rowNames,
  nameField,
  sheet,
  sortableReady,
  testWithAreasLock as test,
  uniqueName,
} from "./support/areas";
import { fontsLoaded } from "./support/fonts";

// Every test here changes the set of active areas or reorders, so all hold the areas lock. They
// only ever move, archive or restore areas they created: the seeded ones (and their order,
// which the screenshots show) stay as they are.

const THEMES = ["dark", "light"] as const;
const undo = (page: Page) => notices(page).getByRole("button", { name: "Deshacer" });

/** Creates two areas; the second one lands right after the first (the lock keeps others out). */
async function createPair(page: Page, first: string, second: string) {
  await createArea(page, first, "Índigo", "Libro abierto");
  await createArea(page, second, "Lima", "Música");
  const names = await rowNames(page);
  expect(names.indexOf(second)).toBe(names.indexOf(first) + 1);
  await sortableReady(page);
}

/** Waits two frames and a beat: dnd-kit measures the rows right after a lift or a move. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 50))),
      ),
  );
}

/**
 * Runs `trigger` and waits until the Server Action it sends has been answered (Next runs the
 * action before it starts the response). The UI changes before that (optimistic), so a reload
 * right after could beat the save.
 */
async function untilSaved(page: Page, trigger: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().headers()["next-action"] !== undefined,
  );
  await trigger();
  expect((await answered).ok()).toBe(true);
}

/** dnd-kit's live region, which speaks the drag in Spanish. */
const dragStatus = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/**
 * Lifts the area with the keyboard and moves it `steps` places (negative: up), waiting for each
 * announcement (dnd-kit measures the rows right after lifting; keys before that are lost).
 */
async function liftAndMove(page: Page, name: string, steps: number) {
  const handle = page.getByRole("button", { name: `Mover ${name}` });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await expect(dragStatus(page)).toContainText(`Tomaste «${name}»`);
  await settle(page);
  for (let step = 0; step < Math.abs(steps); step++) {
    const before = await dragStatus(page).textContent();
    await page.keyboard.press(steps < 0 ? "ArrowUp" : "ArrowDown");
    await expect(dragStatus(page)).not.toHaveText(before ?? "");
  }
}

/** `first` comes right before `second` in the list (now, and after a reload). */
async function expectAdjacent(page: Page, first: string, second: string) {
  await expect
    .poll(async () => {
      const names = await rowNames(page);
      return names.indexOf(second) - names.indexOf(first);
    })
    .toBe(1);
}

test("reorder with Subir/Bajar: instant, focus stays, saved, and Deshacer reverts", async ({
  page,
}, testInfo) => {
  const a = uniqueName("Primera", testInfo);
  const b = uniqueName("Segunda", testInfo);
  await openAreas(page);
  await createPair(page, a, b);
  const total = await editRows(page).count();

  const up = page.getByRole("button", { name: `Subir ${b}` });
  await untilSaved(page, () => up.click());
  await expectAdjacent(page, b, a);
  await expect(up).toBeFocused();
  await expect(notices(page)).toContainText(`«${b}» pasó al lugar ${total - 1} de ${total}.`);
  // Focus never moves to the notice.
  await expect(undo(page)).not.toBeFocused();

  // Saved: still there after a reload.
  await page.reload();
  await expectAdjacent(page, b, a);

  // Two moves in a row share one notice; Deshacer restores the order from before both.
  await page.getByRole("button", { name: `Bajar ${b}` }).click();
  await expectAdjacent(page, a, b);
  await page.getByRole("button", { name: `Subir ${b}` }).click();
  await page.getByRole("button", { name: `Subir ${b}` }).click();
  await expect(notices(page).getByRole("button")).toHaveCount(1);
  await undo(page).click();
  await expectAdjacent(page, b, a);
  await expect(notices(page)).toContainText("Volvió el orden anterior.");
  await page.reload();
  await expectAdjacent(page, b, a);
});

test("reorder by keyboard drag: Space, arrows, Space; Esc cancels", async ({ page }, testInfo) => {
  const a = uniqueName("Arriba", testInfo);
  const b = uniqueName("Abajo", testInfo);
  await openAreas(page);
  await createPair(page, a, b);

  const handle = page.getByRole("button", { name: `Mover ${b}` });
  await expect(handle).toHaveAttribute("aria-roledescription", "elemento ordenable");
  await expect(handle).toHaveAccessibleDescription(/pulsa Espacio o Enter/);

  // Esc cancels: nothing moves, nothing is saved.
  await liftAndMove(page, b, -1);
  await expect(dragStatus(page)).toContainText(`«${b}» está en el lugar`);
  await page.keyboard.press("Escape");
  await expect(dragStatus(page)).toContainText(`Cancelado. «${b}» volvió al lugar`);
  await expectAdjacent(page, a, b);

  await liftAndMove(page, b, -1);
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expectAdjacent(page, b, a);
  await expect(handle).toBeFocused();
  await expect(notices(page)).toContainText(`«${b}» pasó al lugar`);

  await page.reload();
  await expectAdjacent(page, b, a);
});

test("keyboard drag down: focus stays on the handle", async ({ page }, testInfo) => {
  const a = uniqueName("Baja", testInfo);
  const b = uniqueName("Sube", testInfo);
  await openAreas(page);
  await createPair(page, a, b);

  const handle = page.getByRole("button", { name: `Mover ${a}` });
  await liftAndMove(page, a, 1);
  await untilSaved(page, () => page.keyboard.press("Space"));
  await expectAdjacent(page, b, a);
  // Moving down re-inserts the row's node; focus is put back on its handle.
  await expect(handle).toBeFocused();
});

test.describe("touch (phone)", () => {
  test.use({ hasTouch: true });

  // A swipe that starts on a handle scrolls the page thanks to `touch-action: manipulation`
  // (checked below; verified locally with a CDP scroll gesture on mobile emulation, which the
  // CI's headless Chromium does not perform).
  test("the handle lets swipes scroll; a press and drag moves the row", async ({
    page,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), "Touch is the phone's");
    const a = uniqueName("Toque A", testInfo);
    const b = uniqueName("Toque B", testInfo);
    await openAreas(page);
    await createPair(page, a, b);
    const cdp = await page.context().newCDPSession(page);
    const handle = page.getByRole("button", { name: `Mover ${b}` });
    // Not `none`: a swipe over the handle still scrolls the page.
    await expect(handle).toHaveCSS("touch-action", "manipulation");


    // A press of 200 ms lifts the row; then it follows the finger.
    await handle.scrollIntoViewIfNeeded();
    await settle(page);
    const from = (await handle.boundingBox())!;
    const to = (await page.getByRole("button", { name: `Mover ${a}` }).boundingBox())!;
    const x = from.x + from.width / 2;
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    await touch("touchStart", from.y + from.height / 2);
    await expect(dragStatus(page)).toContainText(`Tomaste «${b}»`);
    for (let step = 1; step <= 8; step++) {
      await touch("touchMove", from.y + from.height / 2 + ((to.y - from.y - 4) * step) / 8);
    }
    await expect(dragStatus(page)).toContainText(`«${b}» está en el lugar`);
    await untilSaved(page, () => touch("touchEnd", 0));
    await expectAdjacent(page, b, a);
  });
});

test("drag with the mouse", async ({ page }, testInfo) => {
  const a = uniqueName("Ratón A", testInfo);
  const b = uniqueName("Ratón B", testInfo);
  await openAreas(page);
  await createPair(page, a, b);

  // Radix keeps `pointer-events: none` on the body for a moment after the sheet closes.
  await expect(page.locator("body")).not.toHaveCSS("pointer-events", "none");
  await page.getByRole("button", { name: `Mover ${b}` }).scrollIntoViewIfNeeded();
  // Measure once the list has settled (no scrolling or layout still going on).
  await settle(page);
  const from = (await page.getByRole("button", { name: `Mover ${b}` }).boundingBox())!;
  const to = (await page.getByRole("button", { name: `Mover ${a}` }).boundingBox())!;
  const x = from.x + from.width / 2;
  await page.mouse.move(x, from.y + from.height / 2);
  await page.mouse.down();
  // Past the 4 px activation distance, then onto the row above, in steps.
  await page.mouse.move(x, from.y + from.height / 2 - 6, { steps: 3 });
  await expect(dragStatus(page)).toContainText(`Tomaste «${b}»`);
  await page.mouse.move(x, to.y + to.height / 2 - 4, { steps: 10 });
  await expect(dragStatus(page)).toContainText(`«${b}» está en el lugar`);
  await untilSaved(page, () => page.mouse.up());

  await expectAdjacent(page, b, a);
  await page.reload();
  await expectAdjacent(page, b, a);
});

test("reduced motion: rows jump into place, without sliding", async ({ page }, testInfo) => {
  const a = uniqueName("Quieta A", testInfo);
  const b = uniqueName("Quieta B", testInfo);
  await openAreas(page);
  await createPair(page, a, b);

  /**
   * Inline transitions dnd-kit puts on the rows while one is lifted. Right after a drop it may
   * set `transform 0ms linear`: no motion either.
   */
  const still = (transition: string) => !/[1-9]\d*m?s/.test(transition);
  const transitions = () =>
    list(page)
      .locator(":scope > li")
      .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).style.transition));

  // With motion: lifting and moving makes the other rows slide.
  await liftAndMove(page, b, -1);
  await expect
    .poll(async () => (await transitions()).some((t) => t.includes("transform")))
    .toBe(true);
  await page.keyboard.press("Escape");
  await expectAdjacent(page, a, b);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await liftAndMove(page, b, -1);
  expect((await transitions()).every(still)).toBe(true);
  await page.keyboard.press("Space");
  await expectAdjacent(page, b, a);
  expect((await transitions()).every(still)).toBe(true);
  // The notice only fades in: no rise.
  const toast = notices(page).locator(".bo-toast");
  await expect(toast).toBeVisible();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--motion-travel").trim(),
    ),
  ).toBe("0px");
});

test("archive from the edit sheet, undo, archive again and unarchive", async ({
  page,
}, testInfo) => {
  const a = uniqueName("Guardada", testInfo);
  const b = uniqueName("Vecina", testInfo);
  await openAreas(page);
  await createPair(page, a, b);
  const index = await rowIndex(page, a);

  // Archive: from the edit sheet; the row leaves at once and focus goes to its neighbour.
  await page.getByRole("button", { name: `Editar ${a}` }).click();
  await sheet(page).getByRole("button", { name: "Archivar área" }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page.getByRole("button", { name: `Editar ${a}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Editar ${b}` })).toBeFocused();
  await expect(notices(page)).toContainText(`«${a}» se archivó.`);
  await expect(archivedToggle(page)).toBeVisible();

  // Deshacer (⌘Z / Ctrl+Z works too): back in the same place.
  await undo(page).click();
  await expect.poll(() => rowIndex(page, a)).toBe(index);
  await expect(notices(page)).toContainText(`«${a}» volvió a su lugar.`);
  await page.reload();
  expect(await rowIndex(page, a)).toBe(index);

  // Archive again, keep it archived: it's listed under Archivadas after a reload.
  await page.getByRole("button", { name: `Editar ${a}` }).click();
  await untilSaved(page, () => sheet(page).getByRole("button", { name: "Archivar área" }).click());
  await expect(page.getByRole("button", { name: `Editar ${a}` })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: `Editar ${a}` })).toHaveCount(0);
  await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "false");
  await archivedToggle(page).click();
  await expect(archivedToggle(page)).toHaveAttribute("aria-expanded", "true");
  const restore = archivedList(page).getByRole("button", { name: `Desarchivar ${a}` });
  // Archived areas are read-only: no edit button, only Desarchivar.
  await expect(archivedList(page).getByRole("button", { name: `Editar ${a}` })).toHaveCount(0);

  // Unarchive: to the end of the list, focused, with Deshacer.
  await untilSaved(page, () => restore.click());
  const editA = page.getByRole("button", { name: `Editar ${a}` });
  await expect(editA).toBeVisible();
  expect(await rowIndex(page, a)).toBe((await editRows(page).count()) - 1);
  await expect(notices(page)).toContainText(`«${a}» volvió al final de tus áreas.`);
  await page.reload();
  expect(await rowIndex(page, a)).toBe((await editRows(page).count()) - 1);
});

test("⌘Z / Ctrl+Z undoes from anywhere on the page, not while typing", async ({
  page,
}, testInfo) => {
  const a = uniqueName("Atajo A", testInfo);
  const b = uniqueName("Atajo B", testInfo);
  await openAreas(page);
  await createPair(page, a, b);

  // From the page: undoes the move.
  await page.getByRole("button", { name: `Subir ${b}` }).click();
  await expectAdjacent(page, b, a);
  await page.keyboard.press("ControlOrMeta+z");
  await expectAdjacent(page, a, b);
  await expect(notices(page)).toContainText("Volvió el orden anterior.");
  // Esc on the page (not in a field) dismisses that notice.
  await page.keyboard.press("Escape");
  await expect(notices(page)).toBeEmpty();

  // While typing in a field: the field's own undo runs, the move stays.
  await untilSaved(page, () => page.getByRole("button", { name: `Subir ${b}` }).click());
  await expectAdjacent(page, b, a);
  await expect(undo(page)).toBeVisible();
  let reorders = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) reorders++;
  });
  await page.getByRole("button", { name: `Editar ${a}` }).click();
  await nameField(page).press("End");
  await nameField(page).pressSequentially(" extra");
  await expect(nameField(page)).toHaveValue(`${a} extra`);
  await nameField(page).press("ControlOrMeta+z");
  await expect(nameField(page)).not.toHaveValue(`${a} extra`);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expectAdjacent(page, b, a);
  expect(reorders).toBe(0);
  // The notice waited while the sheet was open: still there, with its Deshacer.
  await expect(undo(page)).toBeVisible();
});

for (const theme of THEMES) {
  test(`${theme} theme: no accessibility violations with the notice and the archived list`, async ({
    page,
  }, testInfo) => {
    const name = uniqueName("Axe", testInfo);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/areas");
    await page.evaluate((value) => localStorage.setItem("theme", value), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await fontsLoaded(page);

    await createArea(page, name, "Rosa", "Corazón");
    await page.getByRole("button", { name: `Editar ${name}` }).click();
    await sheet(page).getByRole("button", { name: "Archivar área" }).click();
    await expect(sheet(page)).toBeHidden();
    await archivedToggle(page).click();
    await expect(archivedList(page)).toBeVisible();
    // Keep the notice on screen while axe runs (hover pauses it).
    await expect(undo(page)).toBeVisible();
    await notices(page).hover();

    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // With focus on the notice's action.
    await undo(page).focus();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // Esc dismisses it from inside; the area stays archived.
    await page.keyboard.press("Escape");
    await expect(notices(page)).toBeEmpty();
    await expect(newAreaButton(page)).toBeVisible();
  });
}
