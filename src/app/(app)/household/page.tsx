import type { Metadata } from "next";
import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ownerDateKey } from "@/lib/time";
import { ScreenServicesProvider } from "@/modules/core/components/screen-services";
import { getTasksByTag } from "@/modules/tasks/contracts";
import { CLEANING_TAG } from "@/modules/household/cleaning";
import { CLEANING_COPY as COPY } from "@/modules/household/cleaning-copy";
import { toCleaningItem } from "@/modules/household/cleaning-view";
import { CleaningScreen } from "@/modules/household/components/cleaning-screen";
import { ShoppingScreen } from "@/modules/household/components/shopping-screen";
import { getProducts } from "@/modules/household/shopping-queries";
import {
  GROUP_PARAM,
  HOUSEHOLD_VIEWS,
  householdPath,
  parseGroup,
  parseView,
  VIEW_PARAM,
} from "@/modules/household/routes";

export const metadata: Metadata = { title: `${COPY.pageTitle} · brahua-os` };

const HEADING_ID = "household-title";

type HouseholdPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Hogar (SPEC-household "Pantallas"): `?vista=` picks the view (Limpieza and Compras; Recetas joins
 * it in H3) and `?agrupar=` how the cleaning is grouped. The cleaning is the pending
 * tasks tagged `limpieza`, read through `tasks`' contract in one query; one Lima day for the page.
 */
export default async function HouseholdPage({ searchParams }: HouseholdPageProps) {
  await requireOwner();
  const search = await searchParams;
  const now = new Date();
  const today = ownerDateKey(now);
  const view = parseView(search[VIEW_PARAM]);
  const group = parseGroup(search[GROUP_PARAM]);

  // Each view reads only its own data.
  const cleaning =
    view === "limpieza" ? (await getTasksByTag(CLEANING_TAG)).map(toCleaningItem) : null;
  const products = view === "compras" ? await getProducts() : null;

  return (
    <ScreenServicesProvider
      label={COPY.noticesLabel}
      actionHint={COPY.undoHint}
      day={{ today, changedMessage: "Empezó un día nuevo." }}
    >
      <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-6 px-4 py-8 pb-[calc(7rem+var(--toast-offset,0px))] md:px-6 lg:py-12 lg:pb-[calc(7rem+var(--toast-offset,0px))]">
        <header className="flex flex-col gap-1">
          <h1 id={HEADING_ID} className="bo-text-display">
            {COPY.pageTitle}
          </h1>
        </header>
        {HOUSEHOLD_VIEWS.length > 1 ? (
          <nav aria-label={COPY.viewsNav}>
            <ul className="flex gap-2">
              {HOUSEHOLD_VIEWS.map((value) => (
                <li key={value}>
                  <Link
                    href={householdPath(value)}
                    aria-current={view === value ? "page" : undefined}
                    className={cn(
                      "bo-text-body-sm flex min-h-11 items-center border-b-2 px-2",
                      view === value ? "border-signal" : "border-divider text-text-secondary",
                    )}
                  >
                    {COPY.views[value]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {cleaning ? <CleaningScreen items={cleaning} today={today} group={group} /> : null}
        {products ? <ShoppingScreen products={products} /> : null}
      </div>
    </ScreenServicesProvider>
  );
}
