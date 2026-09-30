import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { listLifeAreas } from "@/modules/core/queries";
import { AreasManager } from "./_components/areas-manager";

export const metadata: Metadata = { title: "Áreas · brahua-os" };

/** Áreas: the active life areas in their order; create and edit them in a sheet. */
export default async function AreasPage() {
  await requireOwner();
  // Archived areas are managed in C6; this list only shows the active ones.
  const areas = await listLifeAreas();
  return <AreasManager areas={areas} />;
}
