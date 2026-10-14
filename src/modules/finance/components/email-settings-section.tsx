"use client";

import { useId, useState, useTransition } from "react";
import { Key, TextArea, TextField } from "@/design-system";
import { fail, type ActionResult } from "@/lib/action-result";
import { useAnnouncer } from "@/modules/core/components/screen-services";
import { EMAIL_COPY, EMAIL_ERRORS } from "../email/email-copy";
import { setMethodLast4, setOwnNames } from "../email/actions";
import {
  setMethodLast4InputSchema,
  setOwnNamesInputSchema,
  type EmailSettings,
} from "../email/input";
import { FINANCE_COPY } from "../finance-copy";

type Props = {
  initial: EmailSettings;
  /** The sheet is saving something else: nothing here starts. */
  sheetBusy: boolean;
};

async function call(
  action: (input: unknown) => Promise<ActionResult<EmailSettings>>,
  input: unknown,
): Promise<ActionResult<EmailSettings>> {
  try {
    return await action(input);
  } catch {
    // Network failure or a new deployment: the action itself never throws.
    return fail(FINANCE_COPY.checkConnection);
  }
}

/**
 * «Correos del banco» in Ajustes (SPEC-finance-email): «Mis nombres» (transfers to them are not
 * suggestions) and the last four digits of each payment method (how a suggestion picks its method).
 * Every save waits for the server and shows what it answers.
 */
export function EmailSettingsSection({ initial, sheetBusy }: Props) {
  const ids = useId();
  const [settings, setSettings] = useState(initial);
  const [names, setNames] = useState(initial.ownNames.join("\n"));
  const [digits, setDigits] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.methods.map((method) => [method.id, method.last4 ?? ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [announcement, announce] = useAnnouncer();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const locked = pending || sheetBusy;

  function saveNames(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) return;
    const input = { names: names.split("\n") };
    const parsed = setOwnNamesInputSchema.safeParse(input);
    if (!parsed.success) {
      setErrors({ names: parsed.error.issues[0]?.message ?? EMAIL_ERRORS.nameTooLong });
      return;
    }
    setErrors({});
    setBusy("names");
    startTransition(async () => {
      const result = await call(setOwnNames, input);
      setBusy(null);
      if (!result.ok) {
        setErrors({ names: result.fieldErrors?.names?.[0] ?? result.error });
        return;
      }
      setSettings(result.data);
      setNames(result.data.ownNames.join("\n"));
      announce(result.data.ownNames.length === 0 ? EMAIL_COPY.namesCleared : EMAIL_COPY.namesSaved);
    });
  }

  function saveDigits(event: React.FormEvent<HTMLFormElement>, id: string, name: string) {
    event.preventDefault();
    if (locked) return;
    const input = { id, last4: digits[id] ?? "" };
    const parsed = setMethodLast4InputSchema.safeParse(input);
    if (!parsed.success) {
      setErrors({ [id]: parsed.error.issues[0]?.message ?? EMAIL_ERRORS.last4 });
      return;
    }
    setErrors({});
    setBusy(id);
    startTransition(async () => {
      const result = await call(setMethodLast4, input);
      setBusy(null);
      if (!result.ok) {
        setErrors({ [id]: result.error });
        return;
      }
      setSettings(result.data);
      announce(
        parsed.data.last4 === null ? EMAIL_COPY.last4Cleared(name) : EMAIL_COPY.last4Saved(name),
      );
    });
  }

  return (
    <section
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-4"
      data-email-settings=""
    >
      <div className="flex flex-col gap-1">
        <h3 id={`${ids}-title`} className="bo-text-body font-semibold">
          {EMAIL_COPY.settingsHeading}
        </h3>
        <p className="bo-text-body-sm text-text-secondary">{EMAIL_COPY.settingsHelp}</p>
      </div>

      <form noValidate onSubmit={saveNames} className="flex flex-col gap-3" data-own-names-form="">
        <TextArea
          id={`${ids}-names`}
          label={EMAIL_COPY.namesLabel}
          value={names}
          rows={3}
          autoComplete="off"
          help={EMAIL_COPY.namesHelp}
          error={errors.names}
          onChange={(event) => {
            setNames(event.target.value);
            setErrors({});
          }}
        />
        <Key type="submit" className="w-fit" aria-disabled={locked || undefined}>
          {busy === "names" ? EMAIL_COPY.saving : EMAIL_COPY.namesSave}
        </Key>
      </form>

      {settings.methods.length === 0 ? (
        <p className="bo-text-body-sm text-text-secondary">{EMAIL_COPY.noMethods}</p>
      ) : (
        settings.methods.map((method) => (
          <form
            key={method.id}
            noValidate
            onSubmit={(event) => saveDigits(event, method.id, method.name)}
            className="flex flex-col gap-3"
            data-last4-form={method.id}
          >
            <TextField
              id={`${ids}-last4-${method.id}`}
              label={EMAIL_COPY.last4Label(method.name)}
              value={digits[method.id] ?? ""}
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              help={EMAIL_COPY.last4Help}
              error={errors[method.id]}
              onChange={(event) => {
                setDigits({ ...digits, [method.id]: event.target.value });
                setErrors({});
              }}
            />
            <Key type="submit" className="w-fit" aria-disabled={locked || undefined}>
              {busy === method.id ? EMAIL_COPY.saving : EMAIL_COPY.last4Save}
            </Key>
          </form>
        ))
      )}
      <p role="status" className="sr-only" data-email-settings-status="">
        {announcement}
      </p>
    </section>
  );
}
