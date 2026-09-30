import { expect, test as setup } from "@playwright/test";
import { E2E_OWNER, OWNER_STORAGE_STATE } from "./support/owner";

// Signs in once through the real login form and saves the session for the app specs.
setup("owner signs in with the password", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.255.255.1" });
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Contraseña").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { level: 1, name: "brahua-os" })).toBeVisible();
  await page.context().storageState({ path: OWNER_STORAGE_STATE });
});
