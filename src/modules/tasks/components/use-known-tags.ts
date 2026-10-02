"use client";

import { useEffect, useState } from "react";
import { listTaskTags } from "../tag-actions";

/**
 * The tags in use (the suggestions of the tag field), asked for when the field mounts, so they
 * are current (a tag added a minute ago is there). Null while loading; empty if they can't be
 * loaded (the field still works: it just suggests nothing).
 */
export function useKnownTags(): string[] | null {
  const [known, setKnown] = useState<string[] | null>(null);
  useEffect(() => {
    let current = true;
    listTaskTags({})
      .then((result) => {
        if (current) setKnown(result.ok ? result.data : []);
      })
      .catch(() => {
        if (current) setKnown([]);
      });
    return () => {
      current = false;
    };
  }, []);
  return known;
}
