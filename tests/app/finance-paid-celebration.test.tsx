// finance-motion M5: «Pagado» celebrates only after the action saved: the month's total gets a
// signal ring for a second. A refusal does not, and the ring goes away on its own.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fail, ok } from "@/lib/action-result";
import type { FinanceCatalog } from "@/modules/finance/catalog-input";
import { FinanceScreen } from "@/modules/finance/components/finance-screen";
import { FinanceViews } from "@/modules/finance/components/finance-views";
import { MonthView } from "@/modules/finance/components/month-view";
import { markPaid } from "@/modules/finance/payment-actions";
import { RECURRING_ERRORS } from "@/modules/finance/payments-copy";
import { buildPaymentsView } from "@/modules/finance/payments-view";
import type { RecurringItem } from "@/modules/finance/recurring-input";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/modules/finance/payment-actions", () => ({
  createRecurringPayment: vi.fn(),
  editRecurringPayment: vi.fn(),
  archiveRecurringPayment: vi.fn(),
  unarchiveRecurringPayment: vi.fn(),
  deleteRecurringPayment: vi.fn(),
  restoreRecurringPayment: vi.fn(),
  markPaid: vi.fn(),
  undoPaid: vi.fn(),
  skipPeriod: vi.fn(),
  undoSkipped: vi.fn(),
}));

const TODAY = "2026-10-05";
const CATALOG: FinanceCatalog = {
  categories: [],
  methods: [],
  archivedCategories: [],
  archivedMethods: [],
  usdToPenE4: null,
  lastPaymentMethodId: null,
};
const INTERNET: RecurringItem = {
  id: "55555555-5555-4555-8555-000000000001",
  name: "Internet",
  amountCents: 5000,
  currency: "PEN",
  category: null,
  paymentMethod: null,
  cycle: "monthly",
  weekday: null,
  dayOfMonth: 5,
  intervalMonths: null,
  anchorMonth: null,
  startDate: "2026-10-01",
  installmentsTotal: null,
  notes: null,
  archived: false,
};

function renderScreen() {
  return render(
    <FinanceScreen today={TODAY} catalog={CATALOG}>
      <FinanceViews
        initialSection="mes:gas"
        month={
          <MonthView
            month="2026-10"
            expenses={[]}
            pendingPeriods={buildPaymentsView([INTERNET], [], TODAY).pending}
          />
        }
        payments={<p>Recurrentes</p>}
      />
    </FinanceScreen>,
  );
}

const paidTotal = () => document.querySelector("[data-month-total]") as HTMLElement;
const payKey = () => screen.getByRole("button", { name: /^Pagado: Internet,/ });

beforeEach(() => {
  window.matchMedia = vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  vi.mocked(markPaid).mockReset();
});

describe("«Pagado» celebration", () => {
  test("after the pay saved, the month total pulses; the ring goes away by itself", async () => {
    const user = userEvent.setup();
    vi.mocked(markPaid).mockResolvedValue(
      ok({
        dueOn: TODAY,
        name: "Internet",
        closedStamp: null,
        expense: {
          id: "e1",
          description: "Internet",
          amountCents: 5000,
          currency: "PEN",
          exchangeRateE4: null,
          spentOn: TODAY,
          category: null,
          paymentMethod: null,
          recurringPaymentId: INTERNET.id,
        },
      }),
    );
    renderScreen();
    expect(paidTotal()).not.toHaveAttribute("data-paid-pulse");
    await user.click(payKey());
    await waitFor(() => expect(paidTotal()).toHaveAttribute("data-paid-pulse"));
    await within(screen.getByRole("region", { name: "Avisos de Finanzas" })).findByText(
      "Pago registrado",
    );
    await waitFor(() => expect(paidTotal()).not.toHaveAttribute("data-paid-pulse"), {
      timeout: 2500,
    });
  });

  test("a refused pay does not celebrate (positive control above)", async () => {
    const user = userEvent.setup();
    vi.mocked(markPaid).mockResolvedValue(fail(RECURRING_ERRORS.archived));
    renderScreen();
    await user.click(payKey());
    await within(screen.getByRole("region", { name: "Avisos de Finanzas" })).findByText(
      /No se pudo registrar el pago/,
    );
    expect(paidTotal()).not.toHaveAttribute("data-paid-pulse");
  });
});
