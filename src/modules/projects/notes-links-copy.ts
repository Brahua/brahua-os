// User-facing copy of a project's notes and links (P5, Spanish). Apart from projects-copy.ts so
// the sections built in parallel (P3–P5) never edit the same block.
import { PROJECT_NOTES_MAX_LENGTH } from "./project-constants";

const count = (n: number) => n.toLocaleString("es");

/** From this many characters on, the editor shows how many are used. */
export const NOTES_COUNTER_FROM = PROJECT_NOTES_MAX_LENGTH - 2_000;

export const NOTES_COPY = {
  section: "Notas",
  empty: "Sin notas. Aquí caben ideas, decisiones y todo lo que no entra en el objetivo.",
  write: "Escribir notas",
  edit: "Editar notas",
  editorLabel: "Editar notas",
  tabsLabel: "Modo del editor de notas",
  tabWrite: "Escribir",
  tabPreview: "Vista previa",
  textLabel: "Notas en Markdown",
  help: "Markdown: **negrita**, _cursiva_, listas, [enlace](https://…), tablas y casillas (- [ ]). ⌘↵ o Ctrl+↵ guarda.",
  /** The editor's counter, for any limit (projects and tasks both allow 20 000 today). */
  counter: (used: number, max: number) => `${count(used)} de ${count(max)} caracteres.`,
  overLimit: (used: number, max: number) =>
    `${count(used)} de ${count(max)} caracteres: quita ${count(used - max)} para guardar.`,
  previewEmpty: "Nada que mostrar todavía.",
  previewLoading: "Cargando la vista previa…",
  save: "Guardar",
  cancel: "Cancelar",
  saved: "Se guardaron las notas.",
  savedEmpty: "Se quitaron las notas.",
  notSavedTitle: "Sin guardar",
  notSaved: "No se pudieron guardar las notas; volvieron a como estaban.",
  draftKept: "Tu texto sigue en «Editar notas».",
  draftPending: "Tienes un borrador sin guardar de estas notas.",
  // Leaving with unsaved changes
  leaveTitle: "Tienes cambios sin guardar en las notas.",
  leaveText: "Si sales ahora, se pierden. Guárdalos o sigue editando.",
  stay: "Seguir editando",
  leave: "Salir sin guardar",
} as const;

export const LINKS_COPY = {
  section: "Enlaces",
  sectionName: (n: number) => `Enlaces, ${n === 1 ? "1 enlace" : `${n} enlaces`}`,
  listLabel: "Enlaces del proyecto",
  empty: "Sin enlaces. Agrega repositorios, documentos o referencias.",
  add: "Agregar enlace",
  addForm: "Agregar enlace",
  editForm: "Editar enlace",
  urlLabel: "Dirección",
  urlHelp: "http:// o https://. Si no la escribes, se usa https://.",
  labelLabel: "Etiqueta",
  labelHelp: "Opcional, hasta 80 caracteres. Sin etiqueta se muestra el sitio.",
  save: "Guardar",
  cancel: "Cancelar",
  remove: "Quitar enlace",
  newTab: "(se abre en una pestaña nueva)",
  goesTo: (host: string) => `Lleva a ${host}`,
  edit: (text: string) => `Editar enlace ${text}`,
  moveUp: (text: string) => `Subir ${text}`,
  moveDown: (text: string) => `Bajar ${text}`,
  added: (text: string) => `Se agregó el enlace «${text}».`,
  updated: (text: string) => `Se guardó el enlace «${text}».`,
  moved: (text: string, place: number, total: number) =>
    `«${text}» pasó al lugar ${place} de ${total}.`,
  removedTitle: "Enlace quitado",
  removed: (text: string) => `Se quitó «${text}».`,
  undo: "Deshacer",
  restored: (text: string) => `«${text}» volvió a los enlaces.`,
  notSavedTitle: "Sin guardar",
  notSaved: {
    add: "No se pudo agregar el enlace.",
    update: "No se pudo guardar el enlace; volvió a como estaba.",
    move: "No se pudo mover el enlace; volvió a su lugar.",
    remove: "No se pudo quitar el enlace; volvió a la lista.",
    restore: "No se pudo deshacer.",
  },
} as const;
