import { TriangleAlert } from "lucide-react";
import { Icon } from "@/design-system";

/** A field's error under a custom control (TextField draws its own). */
export function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span id={id} className="bo-field__error">
      <Icon icon={TriangleAlert} size="sm" />
      {message}
    </span>
  );
}
