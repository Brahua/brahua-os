import { Tag } from "lucide-react";
import { Icon } from "@/design-system";
import type { TaskTagSummary } from "../task-input";
import { TAGS_COPY } from "../tags-copy";

/** How many tag chips a row shows; the rest are a "+N". */
const SHOWN = 3;

/**
 * The tags in a row's metadata (T4): compact chips that truncate, the first three and "+N".
 * Inside the row's aria-hidden metadata: screen readers hear them through the title's
 * description ("Etiquetas: compras, hogar").
 */
export function TaskRowTags({ tags }: { tags: readonly TaskTagSummary[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, SHOWN);
  const rest = tags.length - shown.length;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" data-task-tags="">
      <Icon icon={Tag} size="xs" className="shrink-0 text-text-secondary" />
      {shown.map((tag) => (
        <span key={tag.id} className="bo-task-tag" title={tag.name}>
          {tag.name}
        </span>
      ))}
      {rest > 0 ? <span className="bo-task-tag">{TAGS_COPY.more(rest)}</span> : null}
    </span>
  );
}
