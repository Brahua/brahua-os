import { GuideSection, Specimen } from "../_components/guide-section";
import { BottomNavDemo, SidebarDemo } from "../_components/navigation-demos";

/**
 * Navigation patterns of `core` (not design system components: SPEC-design-system "Patrones de
 * referencia"), shown with the full module list of the Claude Design reference.
 */
export function NavigationSection() {
  return (
    <GuideSection
      id="navigation"
      title="Navegación"
      description="Patrones de core. Celular: barra inferior con la tecla de captura al centro; con más de 4 secciones, el resto va en «Más». Escritorio (desde 1024 px): barra lateral de 240 px que se contrae a 72 px con [, y atajos 1–8. El ítem actual es una tecla en relieve. La captura aparece desactivada hasta que exista la captura rápida."
    >
      <div className="flex flex-col gap-8">
        <Specimen label="Barra inferior · celular">
          <BottomNavDemo />
        </Specimen>
        <div className="flex flex-wrap items-start gap-6">
          <Specimen label="Barra lateral">
            <SidebarDemo name="Ejemplo: barra lateral" />
          </Specimen>
          <Specimen label="Contraída">
            <SidebarDemo name="Ejemplo: barra lateral contraída" initialCollapsed />
          </Specimen>
        </div>
      </div>
    </GuideSection>
  );
}
