import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import { ThemeSwitch } from "./_components/theme-switch";
import {
  IconKeySection,
  IconSection,
  KbdTooltipSection,
  KeySection,
} from "./_sections/action-sections";
import { AreaIconsSection, AreaTagSection, LedSection } from "./_sections/area-sections";
import {
  ControlsSection,
  ListRowSection,
  SheetSection,
  TextFieldSection,
} from "./_sections/control-sections";
import { NavigationSection } from "./_sections/navigation-sections";
import { SectionLabelSection, StatNumberSection } from "./_sections/data-sections";
import { LcdSection, ProgressSection, WeekSection } from "./_sections/progress-sections";

export const metadata: Metadata = {
  title: "Design system · brahua-os",
  robots: { index: false, follow: false },
};

/**
 * Living style guide, mirroring the "brahua-os Design System" in Claude Design.
 * Owner-only (behind the login), in every environment.
 */
export default async function DesignGuidePage() {
  await requireOwner();

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col px-4 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 py-8">
        <div className="flex flex-col gap-2">
          <p className="bo-text-label text-text-secondary">brahua-os · Panel mono</p>
          <h1 className="bo-text-display">Design system</h1>
        </div>
        <ThemeSwitch />
      </header>

      <div className="flex flex-col">
        <KeySection />
        <IconKeySection />
        <KbdTooltipSection />
        <IconSection />
        <LedSection />
        <AreaTagSection />
        <AreaIconsSection />
        <SectionLabelSection />
        <StatNumberSection />
        <ProgressSection />
        <WeekSection />
        <LcdSection />
        <ControlsSection />
        <TextFieldSection />
        <SheetSection />
        <ListRowSection />
        <NavigationSection />
      </div>
    </div>
  );
}
