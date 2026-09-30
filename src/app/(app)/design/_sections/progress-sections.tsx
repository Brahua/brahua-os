import {
  DayCell,
  DotMatrix,
  Lcd,
  ProgressRing,
  SegmentBar,
  type DotMatrixDay,
} from "@/design-system";
import { ToastDemo } from "../_components/demos";
import { GuideSection, Specimen } from "../_components/guide-section";

const WEEK: DotMatrixDay[] = [
  { label: "L", name: "lunes 28", done: 9, complete: true },
  { label: "M", name: "martes 29", done: 4, state: "today" },
  { label: "X", name: "miércoles 30", state: "upcoming" },
  { label: "J", name: "jueves 1", state: "upcoming" },
  { label: "V", name: "viernes 2", state: "upcoming" },
  { label: "S", name: "sábado 3", state: "upcoming" },
  { label: "D", name: "domingo 4", state: "upcoming" },
];

export function ProgressSection() {
  return (
    <GuideSection
      id="progress"
      title="ProgressRing · SegmentBar"
      description="El anillo mide el día y vive dentro de una LCD. Los segmentos miden metas semanales, uno por unidad."
    >
      <div className="flex flex-wrap items-center gap-8">
        <Lcd block className="w-fit">
          <div className="flex items-center gap-6">
            <ProgressRing value={33} size="sm" />
            <ProgressRing value={58} />
            <ProgressRing value={100} size="lg" caption="DÍA COMPLETO" />
          </div>
        </Lcd>
        <div className="grid w-64 gap-5">
          <Specimen label="4 de 6 · siguiente marcado">
            <SegmentBar total={6} filled={4} next className="w-64" />
          </Specimen>
          <Specimen label="Grande">
            <SegmentBar total={5} filled={5} size="lg" className="w-64" />
          </Specimen>
        </div>
      </div>
    </GuideSection>
  );
}

export function WeekSection() {
  return (
    <GuideSection
      id="week"
      title="DotMatrix · DayCell"
      description="La semana como matriz de puntos dentro de la LCD. Cada día de un hábito: hecho, descanso (guion gris, nunca rojo), hoy o por venir."
    >
      <div className="flex flex-wrap items-start gap-8">
        <Lcd block className="w-fit">
          <DotMatrix days={WEEK} />
        </Lcd>
        <div className="flex flex-wrap items-end gap-5">
          <Specimen label="Hecho">
            <DayCell state="done" label="lunes" />
          </Specimen>
          <Specimen label="Descanso">
            <DayCell state="rest" label="martes" />
          </Specimen>
          <Specimen label="Hoy">
            <DayCell state="today" today label="miércoles" />
          </Specimen>
          <Specimen label="Hoy · hecho">
            <DayCell state="done" today label="miércoles" />
          </Specimen>
          <Specimen label="Por venir">
            <DayCell state="upcoming" label="jueves" />
          </Specimen>
          <Specimen label="Grande">
            <DayCell state="done" size="lg" label="viernes" />
          </Specimen>
        </div>
      </div>
    </GuideSection>
  );
}

export function LcdSection() {
  return (
    <GuideSection
      id="lcd"
      title="Lcd · Toast"
      description="La LCD habla: estado, rachas y avisos compasivos. El toast usa el mismo estilo y ofrece Deshacer."
    >
      <div className="grid max-w-xl gap-4">
        <Lcd tag="Hoy" meta="4/9" live={false}>
          Te faltan 5 para cerrar el día.
        </Lcd>
        <Lcd tag="Racha" live={false}>
          Ayer descansaste de Ejercicio. Hoy retomas.
        </Lcd>
        <Lcd tag="Día completo" signal live={false}>
          Buena toma. Mañana, otra.
        </Lcd>
        <ToastDemo />
      </div>
    </GuideSection>
  );
}
