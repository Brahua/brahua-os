import { ChevronRight, Target } from "lucide-react";
import { AreaTag, Icon, ListRow, SectionLabel } from "@/design-system";
import { GuideSection, Specimen } from "../_components/guide-section";
import { StatNumberDemo } from "../_components/stat-demo";

export function SectionLabelSection() {
  return (
    <GuideSection
      id="section-label"
      title="SectionLabel"
      description="Etiqueta mono en mayúsculas. Es un encabezado por defecto, así las secciones se pueden recorrer con lector de pantalla."
    >
      <div className="flex flex-wrap gap-8">
        <Specimen label="Encabezado">
          <SectionLabel as="h3">Hábitos de hoy</SectionLabel>
        </Specimen>
        <Specimen label="Con contador">
          <SectionLabel as="h3" count="2/6">
            Hábitos
          </SectionLabel>
        </Specimen>
        <Specimen label="xs">
          <SectionLabel as="span" size="xs" count="3">
            Prioridades
          </SectionLabel>
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
      description="Cifras que ruedan al cambiar (NumberFlow). Formato es-PE: soles, dólares y porcentajes."
    >
      <StatNumberDemo />
    </GuideSection>
  );
}

export function ListRowSection() {
  return (
    <GuideSection
      id="list-row"
      title="ListRow"
      description="Fila tocable con divisor. 56 px en el celular; 40 px para listas densas de escritorio."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col overflow-hidden rounded-lg border border-border-subtle">
          <ListRow
            leading={<AreaTag name="Finanzas" color="teal" icon="wallet" showName={false} />}
            description="S/ 2,340 de S/ 3,000 · sept"
            trailing={<Icon icon={ChevronRight} className="text-text-muted" />}
            className="border-t-0"
          >
            Finanzas
          </ListRow>
          <ListRow
            leading={<Icon icon={Target} />}
            description="3 activas · próxima: AWS · 20 nov"
            trailing={<Icon icon={ChevronRight} className="text-text-muted" />}
          >
            Metas
          </ListRow>
          <ListRow href="/design" description="Enlace · usa next/link">
            Áreas de vida
          </ListRow>
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-border-subtle">
          <ListRow density="fine" className="border-t-0">
            Hoy
          </ListRow>
          <ListRow density="fine">Proyectos</ListRow>
          <ListRow density="fine" disabled>
            Notas · deshabilitada
          </ListRow>
        </div>
      </div>
    </GuideSection>
  );
}
