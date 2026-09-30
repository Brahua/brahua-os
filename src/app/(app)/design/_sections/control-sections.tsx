import { ChevronRight, Target } from "lucide-react";
import { AreaTag, Icon, ListRow, TextArea, TextField } from "@/design-system";
import { SegmentedDemo, SheetDemo, SwitchDemo } from "../_components/demos";
import { GuideSection, Specimen } from "../_components/guide-section";

export function ControlsSection() {
  return (
    <GuideSection
      id="controls"
      title="Switch · SegmentedControl"
      description="El interruptor encendido es naranja. La opción elegida del selector es una tecla activada. Flechas, Inicio y Fin cambian la selección."
    >
      <div className="flex flex-wrap items-start gap-10">
        <Specimen label="Switch">
          <SwitchDemo />
        </Specimen>
        <SegmentedDemo />
      </div>
    </GuideSection>
  );
}

export function TextFieldSection() {
  return (
    <GuideSection
      id="text-field"
      title="TextField · TextArea"
      description="Etiqueta, ayuda y error. El error es un borde naranja de 2 px con ícono y mensaje; nunca rojo."
    >
      <div className="grid max-w-3xl gap-6 md:grid-cols-2">
        <TextField label="Tarea" placeholder="¿Qué hay que hacer?" help="Se guarda en Hoy." />
        <TextField label="Monto" defaultValue="doce" error="Ingresa un número." />
        <TextField label="Deshabilitado" defaultValue="No editable" disabled />
        <TextArea label="Nota" placeholder="Escribe lo que estés pensando…" />
      </div>
    </GuideSection>
  );
}

export function SheetSection() {
  return (
    <GuideSection
      id="sheet"
      title="Sheet"
      description="Hoja inferior en el celular y panel lateral de 420 px en escritorio. Esc cierra y el foco vuelve a donde estaba."
    >
      <SheetDemo />
    </GuideSection>
  );
}

export function ListRowSection() {
  return (
    <GuideSection
      id="list-row"
      title="ListRow"
      description="Fila tocable: táctil (64 px) o compacta (44 px, escritorio). Seleccionada = tecla en relieve."
    >
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <div className="bo-list">
          <ListRow
            href="/design"
            leading={<AreaTag area="finance" label="" led={false} />}
            title="Finanzas"
            subtitle="S/ 2,340 de S/ 3,000 · sept"
            trailing={<Icon icon={ChevronRight} />}
          />
          <ListRow
            leading={<Icon icon={Target} />}
            title="Metas"
            subtitle="3 activas · próxima: AWS · 20 nov"
            trailing={<Icon icon={ChevronRight} />}
          />
          <ListRow title="Notas" subtitle="2 nuevas esta semana" />
        </div>
        <div className="bo-list">
          <ListRow compact title="Hoy" selected />
          <ListRow compact title="Proyectos" />
          <ListRow compact title="Hábitos" />
        </div>
      </div>
    </GuideSection>
  );
}
