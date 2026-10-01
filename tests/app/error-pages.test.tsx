import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import AppError from "@/app/(app)/error";
import AppNotFound, { metadata as appNotFoundMetadata } from "@/app/(app)/not-found";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound, { metadata as notFoundMetadata } from "@/app/not-found";
import { getOwnerSession } from "@/lib/auth";

vi.mock("@/lib/auth", () => ({ getOwnerSession: vi.fn() }));
// The shell has its own tests; here it only matters whether the 404 renders inside it.
vi.mock("@/modules/core/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));
// next/font only works inside Next's compiler.
vi.mock("@/design-system/fonts", () => ({ fontVariables: "font-vars" }));

const SECRET = "connection to db.internal:5432 failed for user admin";

function serverError(digest?: string) {
  return Object.assign(new Error(SECRET), digest ? { digest } : {});
}

beforeEach(() => {
  vi.mocked(getOwnerSession).mockReset();
  document.title = "";
});

afterEach(() => {
  localStorage.clear();
});

test("the 404 pages have their own title and are not indexed", () => {
  for (const metadata of [notFoundMetadata, appNotFoundMetadata]) {
    expect(metadata.title).toBe("Página no encontrada · brahua-os");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  }
});

test("signed in, the root 404 renders in the shell and leads back to Hoy", async () => {
  vi.mocked(getOwnerSession).mockResolvedValue({ user: { id: "owner-id" } } as never);
  render(await NotFound());

  expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Nada por aquí" })).toBeInTheDocument();
  expect(screen.getByText("404")).toBeInTheDocument();
  expect(screen.getByText("No encontramos esta página.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Volver a Hoy" })).toHaveAttribute("href", "/");
  expect(screen.queryByRole("link", { name: "Ir a iniciar sesión" })).toBeNull();
});

test("signed out, the root 404 has no shell and points to the login", async () => {
  vi.mocked(getOwnerSession).mockResolvedValue(null);
  render(await NotFound());

  expect(screen.queryByTestId("app-shell")).toBeNull();
  expect(screen.getByRole("main")).toContainElement(
    screen.getByRole("heading", { level: 1, name: "Nada por aquí" }),
  );
  expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toHaveAttribute(
    "href",
    "/login",
  );
  expect(screen.queryByRole("link", { name: "Volver a Hoy" })).toBeNull();
});

test("if the session lookup fails, the root 404 still renders (signed out)", async () => {
  vi.mocked(getOwnerSession).mockRejectedValue(new Error("database down"));
  render(await NotFound());

  expect(screen.getByRole("heading", { level: 1, name: "Nada por aquí" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ir a iniciar sesión" })).toBeInTheDocument();
});

test("notFound() inside (app) renders the signed-in 404 (the layout already has the shell)", () => {
  render(<AppNotFound />);
  expect(screen.getByRole("link", { name: "Volver a Hoy" })).toHaveAttribute("href", "/");
});

test.each([
  ["(app)/error.tsx", AppError],
  ["error.tsx", RootError],
])(
  "%s: blame-free, no technical details, focus on the heading, Reintentar",
  async (_name, Page) => {
    const retry = vi.fn();
    const { container } = render(<Page error={serverError("1073160443")} retry={retry} />);

    const heading = screen.getByRole("heading", { level: 1, name: "Algo no salió bien" });
    expect(heading).toHaveFocus();
    expect(document.title).toBe("Algo no salió bien · brahua-os");
    expect(screen.getByText("No pudimos mostrar esta pantalla.")).toBeInTheDocument();
    expect(screen.getByText(/No es nada que hayas hecho/)).toBeInTheDocument();
    expect(screen.getByText("Código del error: 1073160443")).toBeInTheDocument();
    expect(container.textContent).not.toContain(SECRET);
    expect(container.textContent).not.toMatch(/Error:|stack|at /);
    expect(screen.getByRole("link", { name: "Volver a Hoy" })).toHaveAttribute("href", "/");

    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledTimes(1);
  },
);

test("without a digest (a client error) no code is shown, and the message never is", () => {
  const { container } = render(<AppError error={serverError()} retry={vi.fn()} />);
  expect(screen.queryByText(/Código del error/)).toBeNull();
  expect(container.textContent).not.toContain(SECRET);
});

test("global-error: its own Spanish document, dark by default, without details", () => {
  const html = renderToStaticMarkup(<GlobalError error={serverError("42")} retry={vi.fn()} />);

  expect(html).toMatch(/^<html lang="es" data-theme="dark" class="font-vars h-full antialiased">/);
  expect(html).toContain("<title>Algo no salió bien · brahua-os</title>");
  expect(html).toMatch(/<h1[^>]*>Algo no salió bien<\/h1>/);
  expect(html).toContain("Reintentar");
  expect(html).toContain("Código del error: 42");
  expect(html).not.toContain(SECRET);
});
