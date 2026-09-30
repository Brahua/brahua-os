"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Key, Led, StatNumber } from "@/design-system";

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
