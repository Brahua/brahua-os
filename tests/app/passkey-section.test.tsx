import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PasskeySection } from "@/app/(app)/_components/passkey-section";
import { authClient } from "@/lib/auth-client";
import {
  PASSKEY_REGISTER_UNSUPPORTED_MESSAGE,
  PASSKEY_REGISTERED_MESSAGE,
  PASSKEY_SESSION_NOT_FRESH_MESSAGE,
} from "@/lib/passkey-messages";
import { usePasskeySupport } from "@/lib/passkey-support";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/auth-client", () => ({ authClient: { passkey: { addPasskey: vi.fn() } } }));
vi.mock("@/lib/passkey-support", () => ({ usePasskeySupport: vi.fn() }));

const addPasskey = vi.mocked(authClient.passkey.addPasskey);
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
  router.refresh.mockReset();
  vi.mocked(usePasskeySupport).mockReturnValue(true);
});

const registerButton = () => screen.getByRole("button", { name: "Registrar passkey" });

describe("PasskeySection", () => {
  test("lists each passkey with its name and creation date", () => {
    render(<PasskeySection passkeys={PASSKEYS} />);

    const list = screen.getByRole("list", { name: /Passkeys/ });
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

  test("registers a named passkey, announces it and reloads the list", async () => {
    addPasskey.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.type(screen.getByLabelText("Nombre (opcional)"), "  iPhone ");
    await user.click(registerButton());

    expect(addPasskey).toHaveBeenCalledWith({ name: "iPhone" });
    expect(await screen.findByRole("status")).toHaveTextContent(PASSKEY_REGISTERED_MESSAGE);
    expect(screen.getByLabelText("Nombre (opcional)")).toHaveValue("");
    expect(router.refresh).toHaveBeenCalled();
  });

  test("without a name, lets the plugin keep it unnamed", async () => {
    addPasskey.mockResolvedValue({ data: {}, error: null } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(addPasskey).toHaveBeenCalledWith(undefined);
  });

  test("closing the browser prompt announces nothing", async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { status: 400, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" },
    } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());

    await waitFor(() => expect(registerButton()).toBeEnabled());
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  test("a stale session is explained as an alert", async () => {
    addPasskey.mockResolvedValue({
      data: null,
      error: { status: 403, code: "SESSION_NOT_FRESH" },
    } as never);
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PASSKEY_SESSION_NOT_FRESH_MESSAGE);
  });

  test("a network failure never leaves the button stuck", async () => {
    addPasskey.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    render(<PasskeySection passkeys={[]} />);

    await user.click(registerButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo registrar/);
    expect(registerButton()).toBeEnabled();
  });

  test("an unsupported browser disables registration and says why", () => {
    vi.mocked(usePasskeySupport).mockReturnValue(false);
    render(<PasskeySection passkeys={[]} />);

    expect(registerButton()).toBeDisabled();
    expect(registerButton()).toHaveAccessibleDescription(PASSKEY_REGISTER_UNSUPPORTED_MESSAGE);
  });
});
