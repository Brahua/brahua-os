// The renderers of the notes' task list items (N3), for `<Markdown taskItems>`: the same object on
// the server (the page's render of the saved body) and in the editor (`ClientMarkdown`, for text
// that changed). No "use client": the functions run wherever the Markdown renders, and the
// controls they return are client components that read the editor's context.
import type { MarkdownTaskItems } from "@/lib/markdown/markdown";
import { ConvertLineKey, NoteTaskCheckbox } from "./note-task-lines";

export const NOTE_TASK_ITEMS: MarkdownTaskItems = {
  open: ({ index, text }) => <ConvertLineKey index={index} text={text} />,
  linked: ({ id, name, done }) => <NoteTaskCheckbox id={id} name={name} done={done} />,
};
