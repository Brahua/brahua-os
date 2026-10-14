// Reads of the email suggestions for Server Components. Each one checks the owner first (SPEC-core).
import "server-only";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ownerDateKey } from "@/lib/time";
import type { EmailSettings, SuggestionItem } from "./input";
import { selectEmailSettings } from "./settings";
import { selectSuggestions } from "./suggestions";

/** The inbox of /finance. */
export async function listSuggestions(): Promise<SuggestionItem[]> {
  await requireOwner();
  return selectSuggestions(getDb(), ownerDateKey(new Date()));
}

/** «Mis nombres» and the methods' last four digits (Ajustes). */
export async function getEmailSettings(): Promise<EmailSettings> {
  await requireOwner();
  return selectEmailSettings(getDb());
}
