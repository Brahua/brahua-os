import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon, SectionLabel } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { REMINDERS_SOON_MESSAGE } from "@/modules/reminders/reminders-copy";
import { readTelegramStatus } from "@/modules/reminders/settings";
import { TelegramSection } from "./_components/telegram-section";

export const metadata: Metadata = { title: "Avisos · brahua-os" };

/**
 * Ajustes → Avisos (SPEC-reminders "Pantallas"). R1 is the skeleton: the Telegram connection
 * works; the slots below are filled by the next cuts and keep their place in this order:
 *   R5  "Canal de avisos" (Push · Telegram · Ambos) and the push device state, ABOVE Telegram;
 *   R2  one switch per reminder with its time, and the amount switches, BELOW Telegram.
 */
export default async function RemindersSettingsPage() {
  await requireOwner();
  const status = await readTelegramStatus(getDb());

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 md:px-6 lg:py-12">
      <div className="flex flex-col gap-4">
        <Link
          href="/settings"
          className="bo-text-body-sm flex min-h-11 w-fit items-center gap-2 rounded-md text-text-secondary hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Icon icon={ArrowLeft} size="sm" />
          Ajustes
        </Link>
        <h1 className="bo-text-display">Avisos</h1>
      </div>

      {/* R5 slot: <ChannelSection /> (canal de avisos y dispositivos con push). */}

      <TelegramSection initialStatus={status} />

      {/* R2 slot: <ScheduleSection /> (interruptores, horas y montos). */}
      <section
        aria-labelledby="reminders-schedule"
        className="flex w-full max-w-100 flex-col gap-4"
      >
        <SectionLabel as="h2" id="reminders-schedule" title="Avisos del día" />
        <p className="bo-text-body-sm text-text-secondary">{REMINDERS_SOON_MESSAGE}</p>
      </section>
    </div>
  );
}
