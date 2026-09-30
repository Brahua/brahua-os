import {
  AREA_COLORS,
  AREA_ICON_NAMES,
  AREA_ICONS,
  AreaTag,
  DEFAULT_AREAS,
  Icon,
  Key,
  Led,
} from "@/design-system";
import { GuideSection, Specimen } from "../_components/guide-section";

export function LedSection() {
  return (
    <GuideSection
      id="led"
      title="Led"
      description="Punto de color de un área. Encendido lleva halo. Sobre una tecla activada toma el tono inverso automáticamente."
    >
      <div className="grid grid-cols-4 gap-6 md:grid-cols-8">
        {AREA_COLORS.map((area) => (
          <Specimen key={area} label={area}>
            <div className="flex items-center gap-3">
              <Led area={area} size="lg" />
              <Led area={area} on />
              <Led area={area} size="sm" />
            </div>
          </Specimen>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {AREA_COLORS.slice(0, 4).map((area) => (
          <Key key={area} toggle pressed tabIndex={-1}>
            <Led area={area} />
            {DEFAULT_AREAS[area].label}
          </Key>
        ))}
        <Specimen label="Señal">
          <div className="flex items-center gap-3">
            <Led signal />
            <Led signal on />
          </div>
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function AreaTagSection() {
  return (
    <GuideSection
      id="area-tag"
      title="AreaTag"
      description="Ícono + LED + nombre: inline (metadato), chip (filtro) o large (encabezado). Nunca solo color."
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {AREA_COLORS.map((area) => (
          <AreaTag key={area} area={area} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <Specimen label="Chip">
          <AreaTag area="learning" variant="chip" />
        </Specimen>
        <Specimen label="Large">
          <AreaTag area="health" variant="large" />
        </Specimen>
        <Specimen label="Área propia (paleta hobbies)">
          <AreaTag area="hobbies" label="Música" icon="music" variant="chip" />
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
      description={`Set curado de ${AREA_ICON_NAMES.length} íconos Lucide para elegir al crear un área.`}
    >
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8 lg:grid-cols-10">
        {AREA_ICON_NAMES.map((name) => (
          <li
            key={name}
            className="flex flex-col items-center gap-2 rounded-md bg-surface px-1 py-3 text-center"
          >
            <Icon icon={AREA_ICONS[name]} size="lg" />
            <span className="bo-text-label break-all text-text-secondary normal-case">{name}</span>
          </li>
        ))}
      </ul>
    </GuideSection>
  );
}
