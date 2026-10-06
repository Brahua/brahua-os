// RFC 4122 UUID version 5 (SHA-1, name-based) for the owner scripts' deterministic ids
// (`db:demo`, `db:finance:import`): the same name under the same namespace is always the same id,
// so running a script twice inserts nothing new.
import { createHash } from "node:crypto";

/** RFC 4122 UUID version 5 (SHA-1, name-based). */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name, "utf8").digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
