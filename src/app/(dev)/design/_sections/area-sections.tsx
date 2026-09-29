import {
  AREA_ICON_NAMES,
  AREA_ICONS,
  AreaTag,
  Icon,
  Key,
  Led,
  type AreaColor,
  type AreaIconName,
} from "@/design-system";
import { GuideSection, Specimen } from "../_components/guide-section";

const SAMPLE_AREAS: { name: string; color: AreaColor; icon: AreaIconName }[] = [
  { name: "Hogar", color: "amber", icon: "house" },
  { name: "Salud y Bienestar", color: "green", icon: "heart-pulse" },
  { name: "Finanzas", color: "teal", icon: "wallet" },
  { name: "Aprendizaje", color: "blue", icon: "graduation-cap" },
  { name: "Trabajo", color: "violet", icon: "briefcase" },
  { name: "Relaciones", color: "pink", icon: "users" },
  { name: "Viajes", color: "orange", icon: "plane" },
  { name: "Hobbies", color: "lime", icon: "audio-waveform" },
];

export function LedSection() {
  return (
    <GuideSection
      id="led"
      title="Led"
      description="Punto de color del área. Oscuro: brilla apagado y se aplana sobre la tecla activada. Claro: punto plano apagado y brilla sobre la tecla negra."
    >
      <div className="grid grid-cols-4 gap-6 sm:grid-cols-8">
        {SAMPLE_AREAS.map((area) => (
          <Specimen key={area.color} label={area.color}>
            <div className="flex items-center gap-3">
              <Led color={area.color} size="lg" />
              <Led color={area.color} />
              <Led color={area.color} size="sm" />
            </div>
          </Specimen>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {SAMPLE_AREAS.slice(0, 4).map((area) => (
          <Key key={area.color} aria-pressed tabIndex={-1} className="pointer-events-none">
            <Led color={area.color} on />
            {area.name}
          </Key>
        ))}
      </div>
    </GuideSection>
  );
}

export function AreaTagSection() {
  return (
    <GuideSection
      id="area-tag"
      title="AreaTag"
      description="El área se reconoce por forma (ícono) y color (LED), nunca solo por color."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SAMPLE_AREAS.map((area) => (
          <AreaTag key={area.color} {...area} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Specimen label="sm">
          <AreaTag {...SAMPLE_AREAS[3]} size="sm" />
        </Specimen>
        <Specimen label="Sin nombre visible">
          <AreaTag {...SAMPLE_AREAS[1]} showName={false} />
        </Specimen>
        <Specimen label="Sobre tecla activada">
          <Key aria-pressed tabIndex={-1} className="pointer-events-none">
            <AreaTag {...SAMPLE_AREAS[7]} on />
          </Key>
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function AreaIconsSection() {
  return (
    <GuideSection
      id="area-icons"
      title="Íconos de área"
      description={`Set curado de ${AREA_ICON_NAMES.length} íconos de Lucide que se pueden elegir para un área.`}
    >
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-10">
        {AREA_ICON_NAMES.map((name) => (
          <li
            key={name}
            className="flex flex-col items-center gap-2 rounded-md bg-surface px-1 py-3 text-center"
          >
            <Icon icon={AREA_ICONS[name]} size="lg" />
            <span className="font-mono text-label-xs break-all text-text-muted">{name}</span>
          </li>
        ))}
      </ul>
    </GuideSection>
  );
}
