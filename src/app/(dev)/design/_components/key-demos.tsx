"use client";

import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { Icon, Key } from "@/design-system";

/** Interactive toggle so hover, press and toggled states can be tried by hand. */
export function ToggleKeyDemo() {
  const [on, setOn] = useState(false);
  return (
    <Key aria-pressed={on} onClick={() => setOn(!on)} data-testid="toggle-key">
      {on ? <Icon icon={Check} /> : null}
      Marcar Ejercicio
    </Key>
  );
}

export function CaptureKeyDemo() {
  return (
    <Key variant="signal">
      <Icon icon={Plus} size="lg" />
      Capturar
    </Key>
  );
}
