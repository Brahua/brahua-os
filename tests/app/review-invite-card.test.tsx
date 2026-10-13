// W4 of `weekly-review`: the invitation card and what the root (src/lib/review-extensions.tsx)
// renders from the contract at the edges of the window, with the contract mocked (no database).
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getReviewInviteSlot } from "@/lib/review-extensions";
import { ReviewInviteCard } from "@/modules/weekly-review/components/review-invite-card";
import { getReviewInvite } from "@/modules/weekly-review/contracts";
import { inviteWeek, reviewInvite } from "@/modules/weekly-review/week";

vi.mock("@/modules/weekly-review/contracts", async () => ({
  getReviewInvite: vi.fn(),
  ReviewInviteCard: (
    await vi.importActual<typeof import("@/modules/weekly-review/components/review-invite-card")>(
      "@/modules/weekly-review/components/review-invite-card",
    )
  ).ReviewInviteCard,
}));
vi.mock("@/modules/weekly-review/invite-clock", () => ({
  inviteInstantFor: async (now: Date) => now,
}));

describe("ReviewInviteCard", () => {
  test("says «Semana nueva, pizarra limpia» and links to step 1 of that week", () => {
    render(<ReviewInviteCard weekStart="2026-10-05" />);
    expect(
      screen.getByRole("region", { name: "Semana nueva, pizarra limpia" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Cerrar la semana" });
    expect(link).toHaveAttribute("href", "/review?semana=2026-10-05");
  });

  test("the link is reachable with the keyboard and keeps the focus ring (no disabled, no animation)", async () => {
    render(<ReviewInviteCard weekStart="2026-10-05" />);
    await userEvent.tab();
    const link = screen.getByRole("link", { name: "Cerrar la semana" });
    expect(link).toHaveFocus();
    expect(link.className).not.toMatch(/animate|transition-all/);
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  test("no guilt words", () => {
    const { container } = render(<ReviewInviteCard weekStart="2026-10-05" />);
    expect(container.textContent).not.toMatch(/atrasad|riesgo|fallaste|deuda|⚠️|racha perdida/i);
  });
});

describe("getReviewInviteSlot", () => {
  let closed = false;
  beforeEach(() => {
    // The contract's rule over a fixed clock: the pure week.ts decides, `closed` is the row.
    vi.mocked(getReviewInvite).mockReset();
    vi.mocked(getReviewInvite).mockImplementation(async (now: Date) => {
      const invite = reviewInvite(now, closed);
      return invite
        ? { weekStart: invite.weekStart, href: `/review?semana=${invite.weekStart}` }
        : null;
    });
    closed = false;
  });

  test.each([
    ["Sunday 17:59", "2026-10-11T22:59:00Z", false],
    ["Sunday 18:00", "2026-10-11T23:00:00Z", true],
    ["Monday 23:59", "2026-10-13T04:59:00Z", true],
    ["Tuesday 00:00", "2026-10-13T05:00:00Z", false],
    ["Wednesday noon", "2026-10-14T17:00:00Z", false],
  ])("%s: the card is %s", async (_name, instant, shown) => {
    expect(inviteWeek(new Date(instant)) !== null).toBe(shown);
    const slot = await getReviewInviteSlot(new Date(instant));
    if (!shown) return expect(slot).toBeNull();
    render(<>{slot}</>);
    expect(screen.getByRole("link", { name: "Cerrar la semana" })).toHaveAttribute(
      "href",
      "/review?semana=2026-10-05",
    );
  });

  test("an already closed week gives no card", async () => {
    closed = true;
    expect(await getReviewInviteSlot(new Date("2026-10-11T23:00:00Z"))).toBeNull();
  });
});
