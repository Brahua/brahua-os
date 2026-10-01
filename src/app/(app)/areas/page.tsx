import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { listArchivedLifeAreas, listLifeAreas } from "@/modules/core/queries";
import { AreasManager } from "./_components/areas-manager";

export const metadata: Metadata = { title: "Áreas · brahua-os" };

/**
 * Áreas: the active life areas in their order (create, edit, reorder, archive) and the archived
 * ones (unarchive).
 */
export default async function AreasPage() {
  await requireOwner();
  const [areas, archived] = await Promise.all([listLifeAreas(), listArchivedLifeAreas()]);
  return <AreasManager areas={areas} archived={archived} />;
}
