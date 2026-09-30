import { Check, PanelLeftClose, Plus, Search, Settings, X } from "lucide-react";
import { Icon, IconKey, Kbd, Key, Tooltip } from "@/design-system";
import { HabitPadDemo, ToggleKeyDemo } from "../_components/demos";
import { GuideSection, Specimen } from "../_components/guide-section";

const STATES = [
  { label: "Reposo", className: "" },
  { label: "Hover", className: "is-hover" },
  { label: "Presionada", className: "is-pressed" },
  { label: "Foco", className: "is-focus" },
] as const;

export function KeySection() {
  return (
    <GuideSection
      id="key"
      title="Key"
      description="Tecla física: se hunde 3 px al presionarla; en modo toggle se queda hundida e invertida. Una tecla naranja por pantalla."
    >
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {STATES.map((state) => (
          <Specimen key={state.label} label={state.label}>
            <Key className={state.className} tabIndex={-1}>
              Guardar
            </Key>
            <Key variant="signal" icon={Plus} className={state.className} tabIndex={-1}>
              Capturar
            </Key>
            <Key variant="ghost" className={state.className} tabIndex={-1}>
              Cancelar
            </Key>
          </Specimen>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <Specimen label="Activada">
          <Key toggle pressed icon={Check} tabIndex={-1}>
            Meditación
          </Key>
        </Specimen>
        <Specimen label="Deshabilitada">
          <div className="flex gap-2">
            <Key disabled>Guardar</Key>
            <Key variant="ghost" disabled>
              Cancelar
            </Key>
          </div>
        </Specimen>
        <Specimen label="Con atajo">
          <Key variant="signal" icon={Plus} shortcut="C" tabIndex={-1}>
            Capturar
          </Key>
        </Specimen>
        <Specimen label="Tamaños sm · md · lg">
          <div className="flex items-end gap-2">
            <Key size="sm" tabIndex={-1}>
              Guardar
            </Key>
            <Key tabIndex={-1}>Guardar</Key>
            <Key size="lg" tabIndex={-1}>
              Guardar
            </Key>
          </div>
        </Specimen>
      </div>
      <div className="flex flex-wrap items-end gap-6">
        <Specimen label="Interactiva · prueba hover, presión y teclado">
          <ToggleKeyDemo />
        </Specimen>
        <Specimen label="Pad de hábito (patrón)">
          <HabitPadDemo />
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function IconKeySection() {
  return (
    <GuideSection
      id="icon-key"
      title="IconKey"
      description="Tecla cuadrada de solo ícono. Siempre con nombre accesible y tooltip con atajo."
    >
      <div className="flex flex-wrap items-end gap-6">
        <Specimen label="sm">
          <IconKey icon={Search} label="Buscar" size="sm" shortcut={["⌘", "K"]} />
        </Specimen>
        <Specimen label="md">
          <IconKey icon={Settings} label="Ajustes" />
        </Specimen>
        <Specimen label="lg · signal · redonda">
          <IconKey icon={Plus} label="Capturar" size="lg" variant="signal" round shortcut="C" />
        </Specimen>
        <Specimen label="Ghost">
          <IconKey icon={X} label="Cerrar" variant="ghost" shortcut="Esc" />
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function KbdTooltipSection() {
  return (
    <GuideSection
      id="kbd-tooltip"
      title="Kbd · Tooltip"
      description="Tecla de atajo grabada. El tooltip aparece tras 300 ms de hover o de inmediato con el foco."
    >
      <div className="flex flex-wrap items-center gap-6">
        <Specimen label="Kbd">
          <div className="flex items-center gap-3">
            <Kbd keys={["⌘", "K"]} />
            <Kbd keys="C" />
            <Kbd keys="[" />
            <Kbd keys="Esc" />
          </div>
        </Specimen>
        <Specimen label="Sobre tecla naranja">
          <Key variant="signal" shortcut="C" tabIndex={-1}>
            Capturar
          </Key>
        </Specimen>
        <Specimen label="Tooltip (abierto)">
          <div className="h-12 w-72">
            <Tooltip label="Contraer barra" shortcut="[" open>
              <IconKey
                icon={PanelLeftClose}
                label="Barra lateral"
                variant="ghost"
                tooltip={false}
              />
            </Tooltip>
          </div>
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function IconSection() {
  return (
    <GuideSection
      id="icon"
      title="Icon"
      description="Lucide con trazo 1,75. Hereda el color del texto. 14 · 16 · 18 · 20 · 24 px."
    >
      <div className="flex flex-wrap items-end gap-6">
        {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
          <Specimen key={size} label={size}>
            <Icon icon={Check} size={size} />
          </Specimen>
        ))}
        <Specimen label="Señal">
          <Icon icon={Check} size="xl" className="text-signal-text" />
        </Specimen>
      </div>
    </GuideSection>
  );
}
