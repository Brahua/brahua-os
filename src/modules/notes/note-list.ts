// The list's filters in the URL and its rows' dates (SPEC-notes "Lista"). Pure and client-safe:
// the page reads the parameters on the server and the screen writes them on the client.
import { formatDateKey } from "@/lib/time";
import { NOTES_COPY as COPY } from "./copy";
import { NOTES_MAX_SHOWN, NOTES_PAGE_SIZE } from "./note-constants";
import { daysBetween } from "./note-day";
import type { NoteKindFilter } from "./note-input";
import { AREA_PARAM, KIND_PARAM, NOTES_PATH, SEARCH_PARAM, SHOWN_PARAM } from "./routes";

/** `?tipo=` values (Spanish, they are in the URL) for each kind filter. */
const KIND_PARAM_VALUES: Record<NoteKindFilter, string | null> = {
  all: null,
  daily: "diario",
  page: "notas",
};

/** `?tipo=`: «diario» or «notas»; anything else is «Todas». */
export function kindFromParam(value: string | null): NoteKindFilter {
  if (value === KIND_PARAM_VALUES.daily) return "daily";
  if (value === KIND_PARAM_VALUES.page) return "page";
  return "all";
}

/** `?n=`: a whole number of pages, between one page and the cap. */
export function shownFromParam(value: string | null): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= NOTES_PAGE_SIZE) return NOTES_PAGE_SIZE;
  return Math.min(Math.ceil(number / NOTES_PAGE_SIZE) * NOTES_PAGE_SIZE, NOTES_MAX_SHOWN);
}

/** The list's URL for some filters (`shown` only when beyond the first page; `q` when searching). */
export function notesListUrl({
  kind,
  areaId,
  shown = NOTES_PAGE_SIZE,
  q = "",
}: {
  kind: NoteKindFilter;
  areaId: string | null;
  shown?: number;
  q?: string;
}): string {
  const params = new URLSearchParams();
  const text = q.trim();
  if (text) params.set(SEARCH_PARAM, text);
  const kindValue = KIND_PARAM_VALUES[kind];
  if (kindValue) params.set(KIND_PARAM, kindValue);
  if (areaId) params.set(AREA_PARAM, areaId);
  if (shown > NOTES_PAGE_SIZE) params.set(SHOWN_PARAM, String(shown));
  const query = params.toString();
  return query ? `${NOTES_PATH}?${query}` : NOTES_PATH;
}

/** When a row was last edited: «Hoy», «Ayer», «Hace 3 días» or «3 oct. 2026». */
export function editedLabel(editedOn: string, today: string): string {
  const days = daysBetween(editedOn, today);
  if (days <= 0) return COPY.editedToday;
  if (days === 1) return COPY.editedYesterday;
  if (days < 7) return COPY.editedDaysAgo(days);
  return formatDateKey(editedOn, "short");
}
