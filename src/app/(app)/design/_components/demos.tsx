"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import {
  Key,
  Led,
  SegmentedControl,
  Sheet,
  StatNumber,
  Switch,
  TextArea,
  TextField,
  Toast,
} from "@/design-system";

/** Interactive toggle so hover, press and toggled states can be tried by hand. */
export function ToggleKeyDemo() {
  const [on, setOn] = useState(false);
  return (
    <Key
      toggle
      pressed={on}
      onPressedChange={setOn}
      icon={on ? Check : undefined}
      data-testid="toggle-key"
    >
      Marcar Ejercicio
    </Key>
  );
}

/** Habit pad: the pattern the habits module builds from Key + Led. */
export function HabitPadDemo() {
  const [on, setOn] = useState(false);
  return (
    <Key toggle pressed={on} onPressedChange={setOn} className="bo-key--pad w-44">
      <span className="flex items-center justify-between">
        <Led area="learning" on={on} />
        <span className="bo-key__sub">{on ? "HECHO" : "RACHA 8"}</span>
      </span>
      <span>Lectura 15 min</span>
    </Key>
  );
}

/** Change the values to see digits roll (or swap instantly with reduced motion). */
export function StatNumberDemo() {
  const [step, setStep] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-8">
        <StatNumber value={11 + step} unit="días" label="Racha" />
        <StatNumber
          value={2340 + step * 125.5}
          kind="currency"
          currency="PEN"
          label="Gastado · sept"
        />
        <StatNumber value={19.99} kind="currency" currency="USD" size="sm" label="Suscripción" />
        <StatNumber
          value={Math.min(0.58 + step * 0.07, 1)}
          kind="percent"
          size="lg"
          label="Avance AWS"
        />
      </div>
      <div className="flex gap-2">
        <Key size="sm" onClick={() => setStep((s) => s + 1)}>
          Sumar
        </Key>
        <Key size="sm" variant="ghost" onClick={() => setStep(0)}>
          Reiniciar
        </Key>
      </div>
    </div>
  );
}

/** Tabs and radio picker with keyboard navigation. */
export function SegmentedDemo() {
  const [tab, setTab] = useState<"active" | "paused" | "ideas">("active");
  const [freq, setFreq] = useState<"daily" | "5w" | "3w">("5w");
  return (
    <div className="grid max-w-md gap-4">
      <SegmentedControl
        label="Estado del proyecto"
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "active", label: "Activos", count: 3 },
          { value: "paused", label: "Pausados", count: 2 },
          { value: "ideas", label: "Ideas", count: 4 },
        ]}
      />
      <SegmentedControl
        mode="radio"
        touch
        label="Frecuencia"
        value={freq}
        onValueChange={setFreq}
        options={[
          { value: "daily", label: "Diario" },
          { value: "5w", label: "5 × sem" },
          { value: "3w", label: "3 × sem" },
        ]}
      />
    </div>
  );
}

export function SwitchDemo() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center gap-4">
      <Switch checked={on} onCheckedChange={setOn} label="Recordatorio de revisión" />
      <Switch checked={false} disabled label="Recordatorio deshabilitado" />
    </div>
  );
}

/** Opens the bottom sheet (phone) and the side panel (desktop). */
export function SheetDemo() {
  const [bottom, setBottom] = useState(false);
  const [side, setSide] = useState(false);
  return (
    <div className="flex flex-wrap gap-3">
      <Key variant="signal" icon={Plus} shortcut="C" onClick={() => setBottom(true)}>
        Capturar
      </Key>
      <Key onClick={() => setSide(true)}>Ver proyecto</Key>
      <Sheet
        open={bottom}
        onOpenChange={setBottom}
        title="Captura rápida"
        footer={
          <Key variant="signal" block onClick={() => setBottom(false)}>
            Guardar tarea
          </Key>
        }
      >
        <TextField label="Tarea" placeholder="¿Qué hay que hacer?" />
      </Sheet>
      <Sheet
        open={side}
        onOpenChange={setSide}
        variant="side"
        title="Certificación AWS"
        subtitle="Aprendizaje · meta 20 nov"
        footer={
          <>
            <Key block onClick={() => setSide(false)}>
              Pausar
            </Key>
            <Key variant="ghost" block onClick={() => setSide(false)}>
              Cerrar
            </Key>
          </>
        }
      >
        <TextArea label="Notas" placeholder="Escribe lo que estés pensando…" />
      </Sheet>
    </div>
  );
}

/** Toast with a working Undo action. */
export function ToastDemo() {
  const [undone, setUndone] = useState(false);
  return (
    <Toast
      title={undone ? "Deshecho" : "Tarea guardada · hoy"}
      text="Comprar cuerdas para el bajo"
      onAction={undone ? undefined : () => setUndone(true)}
    />
  );
}
