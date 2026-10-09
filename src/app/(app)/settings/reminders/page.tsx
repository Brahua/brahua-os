import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readChannelSummary, readSchedule, readTelegramStatus } from "@/modules/reminders/settings";
import { ChannelSection } from "./_components/channel-section";
import { ScheduleSection } from "./_components/schedule-section";
import { TelegramSection } from "./_components/telegram-section";

export const metadata: Metadata = { title: "Avisos · brahua-os" };

/**
 * Ajustes → Avisos (SPEC-reminders "Pantallas"). R1 built the skeleton (the Telegram connection),
 * R2 filled "Avisos del día" (one switch per reminder with its time, and the Telegram amounts
 * switch), R4 added the habits' switch next to the others, and R5 put "Canal de avisos" (Push ·
 * Telegram · Ambos) and this device's push state ABOVE Telegram.
 */
export default async function RemindersSettingsPage() {
  await requireOwner();
  const db = getDb();
  const [status, schedule, channel] = await Promise.all([
    readTelegramStatus(db),
    readSchedule(db),
    readChannelSummary(db),
  ]);

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

      <ChannelSection initial={channel} />

      <TelegramSection initialStatus={status} />

      <ScheduleSection initial={schedule} />
    </div>
  );
}
