// The new records of a finished session, under its summary (SPEC-health "Al terminar", E3):
// «Sentadilla con barra: 82,5 kg», «Press de banca: 1RM estimado 79 kg». Nothing without any.
import { Trophy } from "lucide-react";
import { Icon } from "@/design-system";
import type { SessionRecord } from "../records";
import { RECORDS_COPY as COPY } from "../records-copy";

export function SessionRecords({ records }: { records: readonly SessionRecord[] }) {
  if (records.length === 0) return null;
  return (
    <ul aria-label={COPY.newListLabel} className="flex flex-col gap-1" data-session-records="">
      {records.map((record) => (
        <li
          key={`${record.exerciseId}:${record.metric}`}
          className="bo-text-body flex items-start gap-2"
          data-session-record={record.metric}
        >
          <Icon icon={Trophy} size="sm" className="mt-1 shrink-0 text-text-secondary" />
          <span className="min-w-0 break-words">
            {COPY.newRecord(record.exerciseName, record.metric, record.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
