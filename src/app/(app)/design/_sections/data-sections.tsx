import { SectionLabel } from "@/design-system";
import { StatNumberDemo } from "../_components/demos";
import { GuideSection, Specimen } from "../_components/guide-section";

export function SectionLabelSection() {
  return (
    <GuideSection
      id="section-label"
      title="SectionLabel"
      description="Etiqueta de sección en mono mayúsculas, con contador a la derecha."
    >
      <div className="grid max-w-md gap-6">
        <Specimen label="Con contador">
          <SectionLabel title="Hábitos" count="2/6" className="w-80" />
        </Specimen>
        <Specimen label="Señal">
          <SectionLabel title="Hoy" count="Martes 29" signal className="w-80" />
        </Specimen>
      </div>
    </GuideSection>
  );
}

export function StatNumberSection() {
  return (
    <GuideSection
      id="stat-number"
      title="StatNumber"
      description="Cifra destacada en IBM Plex Mono tabular. Los números ruedan al cambiar y se leen como una sola cifra."
    >
      <StatNumberDemo />
    </GuideSection>
  );
}
