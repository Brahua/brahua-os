import { Check, Plus, Search, Settings, X } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon, IconKey, Key } from "@/design-system";
import { GuideSection, Specimen } from "./_components/guide-section";
import { CaptureKeyDemo, ToggleKeyDemo } from "./_components/key-demos";
import { ThemeSwitch } from "./_components/theme-switch";
import { AreaIconsSection, AreaTagSection, LedSection } from "./_sections/area-sections";

export const metadata: Metadata = {
  title: "Design system · brahua-os",
  robots: { index: false, follow: false },
};

/**
 * Living style guide. Dev-only until `core` adds owner-only auth:
 * production builds return 404 unless built with DESIGN_GUIDE=enabled (used by E2E).
 */
export default function DesignGuidePage() {
  if (process.env.NODE_ENV === "production" && process.env.DESIGN_GUIDE !== "enabled") {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-(--content-max) flex-col px-4 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4 py-8">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-label-xs text-text-muted uppercase">
            brahua-os · Panel mono
          </p>
          <h1 className="text-display font-stretch-125% uppercase">Design system</h1>
        </div>
        <ThemeSwitch />
      </header>

      <main className="flex flex-col">
        <GuideSection
          id="key"
          title="Key"
          description="Tecla física: se hunde 3 px al presionarla y se invierte cuando está activada. Hover solo con mouse."
        >
          <div className="flex flex-wrap gap-6">
            <Specimen label="Default · reposo">
              <Key>Guardar</Key>
            </Specimen>
            <Specimen label="Default · activada">
              <Key aria-pressed>Meditación</Key>
            </Specimen>
            <Specimen label="Default · deshabilitada">
              <Key disabled>Guardar</Key>
            </Specimen>
            <Specimen label="Signal">
              <CaptureKeyDemo />
            </Specimen>
            <Specimen label="Signal · deshabilitada">
              <Key variant="signal" disabled>
                Capturar
              </Key>
            </Specimen>
            <Specimen label="Ghost">
              <Key variant="ghost">Cancelar</Key>
            </Specimen>
          </div>
          <div className="flex flex-wrap items-end gap-6">
            <Specimen label="Tamaño sm · 44">
              <Key size="sm">Guardar</Key>
            </Specimen>
            <Specimen label="Tamaño md · 48">
              <Key size="md">Guardar</Key>
            </Specimen>
            <Specimen label="Tamaño lg · 56">
              <Key size="lg">Guardar</Key>
            </Specimen>
            <Specimen label="Interactiva · prueba hover, presión y teclado">
              <ToggleKeyDemo />
            </Specimen>
          </div>
        </GuideSection>

        <GuideSection
          id="icon-key"
          title="IconKey"
          description="Tecla cuadrada de solo ícono. El nombre accesible es obligatorio."
        >
          <div className="flex flex-wrap items-end gap-6">
            <Specimen label="sm">
              <IconKey size="sm" aria-label="Buscar">
                <Icon icon={Search} />
              </IconKey>
            </Specimen>
            <Specimen label="md">
              <IconKey aria-label="Ajustes">
                <Icon icon={Settings} />
              </IconKey>
            </Specimen>
            <Specimen label="lg · signal">
              <IconKey size="lg" variant="signal" aria-label="Capturar">
                <Icon icon={Plus} size="xl" />
              </IconKey>
            </Specimen>
            <Specimen label="Ghost">
              <IconKey variant="ghost" aria-label="Cerrar">
                <Icon icon={X} />
              </IconKey>
            </Specimen>
          </div>
        </GuideSection>

        <GuideSection
          id="icon"
          title="Icon"
          description="Lucide con trazo 1.75. Hereda el color del texto. Tamaños 16, 18, 20 y 24 px."
        >
          <div className="flex flex-wrap items-end gap-6">
            <Specimen label="sm · 16">
              <Icon icon={Check} size="sm" />
            </Specimen>
            <Specimen label="md · 18">
              <Icon icon={Check} size="md" />
            </Specimen>
            <Specimen label="lg · 20">
              <Icon icon={Check} size="lg" />
            </Specimen>
            <Specimen label="xl · 24">
              <Icon icon={Check} size="xl" />
            </Specimen>
            <Specimen label="Color de señal">
              <Icon icon={Check} size="xl" className="text-signal-text" />
            </Specimen>
          </div>
        </GuideSection>
        <LedSection />
        <AreaTagSection />
        <AreaIconsSection />
      </main>
    </div>
  );
}
