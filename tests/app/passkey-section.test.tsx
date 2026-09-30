import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PasskeySection } from "@/app/(app)/settings/_components/passkey-section";
import { authClient } from "@/lib/auth-client";
import {
  PASSKEY_DELETED_MESSAGE,
  PASSKEY_NAME_FAILED_MESSAGE,
  PASSKEY_REGISTER_FAILED_MESSAGE,
  PASSKEY_REGISTER_UNSUPPORTED_MESSAGE,
  PASSKEY_REGISTERED_MESSAGE,
  PASSKEY_SESSION_NOT_FRESH_MESSAGE,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    passkey: { addPasskey: vi.fn(), updatePasskey: vi.fn(), deletePasskey: vi.fn() },
  },
}));
vi.mock("@/lib/passkey-support", () => ({ usePasskeySupport: vi.fn() }));

const addPasskey = vi.mocked(authClient.passkey.addPasskey);
const updatePasskey = vi.mocked(authClient.passkey.updatePasskey);
const deletePasskey = vi.mocked(authClient.passkey.deletePasskey);
const PASSKEYS = [
  {
    id: "pk-1",
    label: "MacBook",
    createdAt: "2026-09-30T15:00:00.000Z",
    createdLabel: "30 de setiembre de 2026",
  },
];

beforeEach(() => {
  addPasskey.mockReset();
  updatePasskey.mockReset();
  deletePasskey.mockReset();
  router.refresh.mockReset();
  vi.mocked(usePasskeySupport).mockReturnValue(true);
});

const registerButton = () =>
  screen.getByRole("button", { name: /Registrar passkey|Esperando la passkey/ });

describe("PasskeySection: list", () => {
  test("the heading reads the count as a separate word", () => {
    render(<PasskeySection passkeys={PASSKEYS} />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveAccessibleName("Passkeys, 1 en total");
  });

  test("lists each passkey with its name and creation date", () => {
    render(<PasskeySection passkeys={PASSKEYS} />);

    const list = screen.getByRole("list", { name: "Tus passkeys" });
    expect(list).toHaveTextContent("MacBook");
    const date = screen.getByText("30 de setiembre de 2026");
    expect(date.tagName).toBe("TIME");
    expect(date).toHaveAttribute("dateTime", "2026-09-30T15:00:00.000Z");
  });

  test("says when there are none yet", () => {
    render(<PasskeySection passkeys={[]} />);
    expect(screen.getByText("Todavía no tienes passkeys.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("PasskeySection: register", () => {
  test("registers without a name (the keychain keeps the email), then sets the label", async () => {
    addPasskey.mockResolvedValue({ data: { id: "pk-new" }, error: null } as never);
    updatePasskey.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.type(screen.getByLabelText("Nombre (opcional)"), "  iPhone ");
    await user.click(registerButton());

    expect(addPasskey).toHaveBeenCalledWith();
    expect(updatePasskey).toHaveBeenCalledWith({ id: "pk-new", name: "iPhone" });
    expect(await screen.findByRole("status")).toHaveTextContent(PASSKEY_REGISTERED_MESSAGE);
    expect(screen.getByLabelText("Nombre (opcional)")).toHaveValue("");
    expect(router.refresh).toHaveBeenCalled();
  });

  test("without a name, no label is set", async () => {
    addPasskey.mockResolvedValue({ data: { id: "pk-new" }, error: null } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    await screen.findByText(PASSKEY_REGISTERED_MESSAGE);
    expect(updatePasskey).not.toHaveBeenCalled();
  });

  test("if the label cannot be saved, says so (the passkey itself works)", async () => {
    addPasskey.mockResolvedValue({ data: { id: "pk-new" }, error: null } as never);
    updatePasskey.mockResolvedValue({ data: null, error: { status: 500 } } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.type(screen.getByLabelText("Nombre (opcional)"), "iPhone");
    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_NAME_FAILED_MESSAGE);
    expect(router.refresh).toHaveBeenCalled();
  });

  test("the name field is capped at 50 characters", () => {
    render(<PasskeySection passkeys={[]} />);
    expect(screen.getByLabelText("Nombre (opcional)")).toHaveAttribute("maxLength", "50");
  });

  test("while the prompt is open the button keeps the focus and ignores presses", async () => {
    addPasskey.mockReturnValue(new Promise(() => {}) as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    await user.click(registerButton());

    expect(registerButton()).toHaveAttribute("aria-disabled", "true");
    expect(registerButton()).not.toBeDisabled();
    expect(registerButton()).toHaveFocus();
    expect(addPasskey).toHaveBeenCalledTimes(1);
  });

  test("closing the browser prompt announces nothing", async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" },
    } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());

    await waitFor(() => expect(registerButton()).toHaveAttribute("aria-disabled", "false"));
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  test("a stale session is explained and attached to the button", async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { status: 403, code: "SESSION_NOT_FRESH" },
    } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SESSION_NOT_FRESH_MESSAGE);
    expect(registerButton()).toHaveAccessibleDescription(PASSKEY_SESSION_NOT_FRESH_MESSAGE);
  });

  test("other 403s get the generic message", async () => {
    addPasskey.mockResolvedValue({ data: null, error: { status: 403 } } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_REGISTER_FAILED_MESSAGE);
  });

  test("a network failure never leaves the button stuck", async () => {
    addPasskey.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_REGISTER_FAILED_MESSAGE);
    expect(registerButton()).toHaveAttribute("aria-disabled", "false");
  });

  test("an unsupported browser: reachable with Tab, marked disabled, and says why", async () => {
    vi.mocked(usePasskeySupport).mockReturnValue(false);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    expect(registerButton()).toHaveAttribute("aria-disabled", "true");
    expect(registerButton()).not.toBeDisabled();
    expect(registerButton()).toHaveAccessibleDescription(PASSKEY_REGISTER_UNSUPPORTED_MESSAGE);
    await user.click(registerButton());
    expect(addPasskey).not.toHaveBeenCalled();
  });
});

describe("PasskeySection: delete", () => {
  const deleteButton = () => screen.getByRole("button", { name: "Eliminar MacBook" });

  test("asks inside the page first and focuses the safe choice", async () => {
    const user = userEvent.setup();
    render(<PasskeySection passkeys={PASSKEYS} />);

    await user.click(deleteButton());

    expect(deleteButton()).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: /¿Eliminar «MacBook»\?/ });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(deletePasskey).not.toHaveBeenCalled();
  });

  test("cancelling (button or Escape) closes it and returns the focus to the row", async () => {
    const user = userEvent.setup();
    render(<PasskeySection passkeys={PASSKEYS} />);

    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(deleteButton()).toHaveFocus();

    await user.click(deleteButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(deleteButton()).toHaveFocus();
  });

  test("confirming deletes it, announces it and moves the focus to the heading", async () => {
    deletePasskey.mockResolvedValue({ data: { status: true }, error: null } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={PASSKEYS} />);

    await user.click(deleteButton());
    await user.click(screen.getByRole("button", { name: "Sí, eliminar" }));

    expect(deletePasskey).toHaveBeenCalledWith({ id: "pk-1" });
    expect(await screen.findByRole("status")).toHaveTextContent(PASSKEY_DELETED_MESSAGE);
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    expect(router.refresh).toHaveBeenCalled();
  });

  test("a failure keeps the confirmation open with the reason attached", async () => {
    deletePasskey.mockResolvedValue({
      data: null,
      error: { status: 403, code: "SESSION_NOT_FRESH" },
    } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={PASSKEYS} />);

    await user.click(deleteButton());
    const confirm = screen.getByRole("button", { name: "Sí, eliminar" });
    await user.click(confirm);

    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SESSION_NOT_FRESH_MESSAGE);
    expect(screen.getByRole("group")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, eliminar" })).toHaveAccessibleDescription(
      PASSKEY_SESSION_NOT_FRESH_MESSAGE,
    );
    expect(screen.getByRole("button", { name: "Sí, eliminar" })).toHaveFocus();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
