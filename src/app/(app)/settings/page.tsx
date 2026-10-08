import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Icon, ListRow, SectionLabel } from "@/design-system";
import { requireOwner } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { areShortcutsEnabled, SHORTCUTS_COOKIE } from "@/modules/core/nav-preferences";
import { listPasskeys } from "@/modules/core/passkeys";
import { PasskeySection } from "./_components/passkey-section";
import { ShortcutsSwitch } from "./_components/shortcuts-switch";
import { SignOutButton } from "./_components/sign-out-button";
import { ThemePicker } from "./_components/theme-picker";

export const metadata: Metadata = { title: "Ajustes · brahua-os" };

/** A titled settings section; `id` names it (region landmark) through its SectionLabel. */
function SettingsSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex w-full max-w-100 flex-col gap-4">
      <SectionLabel as="h2" id={id} title={title} />
      {children}
    </section>
  );
}

/** Ajustes: theme, keyboard shortcuts, reminders, passkeys and session. Preferences are per device. */
export default async function SettingsPage() {
  const session = await requireOwner();
  const [passkeys, cookieStore] = await Promise.all([
    listPasskeys(getDb(), session.user.id),
    cookies(),
  ]);
  const shortcutsEnabled = areShortcutsEnabled(cookieStore.get(SHORTCUTS_COOKIE)?.value);

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col gap-10 px-4 py-8 md:px-6 lg:py-12">
      <h1 className="bo-text-display">Ajustes</h1>

      <SettingsSection id="settings-appearance" title="Apariencia">
        <ThemePicker labelledBy="settings-appearance" describedBy="settings-theme-hint" />
        <p id="settings-theme-hint" className="bo-text-body-sm text-text-secondary">
          «Sistema» sigue el modo claro u oscuro de tu dispositivo.
        </p>
      </SettingsSection>

      <SettingsSection id="settings-keyboard" title="Teclado">
        <ShortcutsSwitch initialEnabled={shortcutsEnabled} />
      </SettingsSection>

      <SettingsSection id="settings-reminders" title="Avisos">
        <div className="bo-list">
          <ListRow
            href="/settings/reminders"
            leading={<Icon icon={Bell} size="md" />}
            title="Telegram y avisos del día"
            subtitle="Conecta el bot y elige qué recibir"
          />
        </div>
      </SettingsSection>

      <PasskeySection passkeys={passkeys} />

      <SettingsSection id="settings-session" title="Sesión">
        <SignOutButton />
      </SettingsSection>
    </div>
  );
}
