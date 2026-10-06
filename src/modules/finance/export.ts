// Tables `finance` offers to `pnpm db:export` (src/lib/data-export.ts): all six, with archived and
// deleted rows on purpose (the export is the owner's history, not a view). The weekly `pg_dump`
// includes them on its own.
import type { ExportableTable } from "@/lib/data-export";
import {
  financeCategories,
  financeExpenses,
  financePaymentMethods,
  financeRecurringPayments,
  financeSettings,
  financeSettlements,
} from "./db/schema";

export const financeExportTables: ExportableTable[] = [
  { table: financeCategories, orderBy: [financeCategories.createdAt, financeCategories.id] },
  {
    table: financePaymentMethods,
    orderBy: [financePaymentMethods.createdAt, financePaymentMethods.id],
  },
  {
    table: financeRecurringPayments,
    orderBy: [financeRecurringPayments.createdAt, financeRecurringPayments.id],
  },
  { table: financeExpenses, orderBy: [financeExpenses.spentOn, financeExpenses.id] },
  {
    table: financeSettlements,
    orderBy: [financeSettlements.recurringPaymentId, financeSettlements.dueOn],
  },
  { table: financeSettings, orderBy: [financeSettings.id] },
];
