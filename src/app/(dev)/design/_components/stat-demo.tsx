"use client";

import { useState } from "react";
import { Key, SectionLabel, StatNumber } from "@/design-system";

/** Change the values to see digits roll (or swap instantly with reduced motion). */
export function StatNumberDemo() {
  const [step, setStep] = useState(0);
  const streak = 11 + step;
  const spent = 2340 + step * 125.5;
  const progress = Math.min(0.58 + step * 0.07, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-8">
        <div className="flex flex-col gap-1">
          <SectionLabel as="span" size="xs">
            Racha
          </SectionLabel>
          <StatNumber value={streak} size="title" />
        </div>
        <div className="flex flex-col gap-1">
          <SectionLabel as="span" size="xs">
            Gastado · sept
          </SectionLabel>
          <StatNumber value={spent} kind="currency" currency="PEN" size="title-sm" />
        </div>
        <div className="flex flex-col gap-1">
          <SectionLabel as="span" size="xs">
            Suscripción
          </SectionLabel>
          <StatNumber value={19.99} kind="currency" currency="USD" />
        </div>
        <div className="flex flex-col gap-1">
          <SectionLabel as="span" size="xs">
            Avance AWS
          </SectionLabel>
          <StatNumber value={progress} kind="percent" size="display" />
        </div>
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
