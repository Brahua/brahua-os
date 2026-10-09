"use client";

import { BellOff, BellRing, Smartphone } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Icon, Key, Lcd, ListRow, SectionLabel, SegmentedControl } from "@/design-system";
import {
  getPushDeviceState,
  setDeliveryChannel,
  subscribePushDevice,
  unsubscribePushDevice,
} from "@/modules/reminders/actions";
import { CHANNEL_COPY, channelNote } from "@/modules/reminders/channel-copy";
import { selectChannels } from "@/modules/reminders/policy";
import {
  pushSupport,
  readBrowserFacts,
  sameApplicationServerKey,
  urlBase64ToBytes,
} from "@/modules/reminders/push/browser";
import { DELIVERY_CHANNELS, type DeliveryChannel } from "@/modules/reminders/reminders-constants";
import type { ChannelSummary } from "@/modules/reminders/settings";

type Message = { tone: "status" | "error"; text: string };
type Pending = "activate" | "deactivate" | "channel" | null;
/** What this browser can do and has done about push. */
type DeviceState = "checking" | "unsupported" | "needs_install" | "denied" | "off" | "on";
type FocusTarget = "activate" | "deactivate" | "heading";

const OPTIONS = DELIVERY_CHANNELS.map((value) => ({
  value,
  label: CHANNEL_COPY.options[value],
}));

/**
 * Ajustes → Avisos → Canal de avisos: the choice (Push, Telegram or Ambos), what it means right
 * now (with the fallback to Telegram while no device has push), and this device's push state:
 * activate (a tap, because iOS asks for the gesture: permission, service worker, subscription,
 * then the server records it) or deactivate. In an iPhone's browser tab push cannot work, so the
 * section explains how to install the app instead of showing a dead button.
 *
 * Controls use `aria-disabled` plus a guard, never `disabled`, so the focused control keeps its
 * focus while saving; after a change the focus is put back explicitly. The summary of Telegram
 * comes with the page, so it can be one step behind a Telegram link opened in this same visit.
 */
export function ChannelSection({ initial }: { initial: ChannelSummary }) {
  const headingId = useId();
  const errorId = useId();
  const noteId = useId();
  const [summary, setSummary] = useState(initial);
  // A new `initial` (the page was refreshed by a server change) replaces what is shown.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setSummary(initial);
  }
  const [device, setDevice] = useState<DeviceState>("checking");
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const activateRef = useRef<HTMLButtonElement>(null);
  const deactivateRef = useRef<HTMLButtonElement>(null);
  const focusAfterRender = useRef<FocusTarget | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // What this browser has: support, permission and whether the server sends to its subscription.
  useEffect(() => {
    let cancelled = false;
    async function detect() {
      let next: DeviceState = "off";
      try {
        const support = pushSupport(readBrowserFacts());
        if (support !== "supported") next = support;
        else if (Notification.permission === "denied") next = "denied";
        else {
          const registration = await navigator.serviceWorker.getRegistration("/");
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) {
            const state = await getPushDeviceState({ endpoint: subscription.endpoint });
            if (state.ok && state.data.active) next = "on";
          }
        }
      } catch {
        // Not knowing is "off": the owner can still press the button.
        next = "off";
      }
      if (cancelled) return;
      setDevice(next);
      // Hydration marker (the E2E waits for it before the first click): set once the state is known.
      sectionRef.current?.setAttribute("data-push-ready", "true");
    }
    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

  // Puts the focus where the change left it (the key that had it was replaced).
  useEffect(() => {
    const target = focusAfterRender.current;
    if (!target) return;
    focusAfterRender.current = null;
    const element =
      target === "activate"
        ? activateRef.current
        : target === "deactivate"
          ? deactivateRef.current
          : document.getElementById(headingId);
    element?.focus();
  }, [device, headingId]);

  async function chooseChannel(next: DeliveryChannel) {
    if (pending || next === summary.deliveryChannel) return;
    const before = summary;
    setPending("channel");
    setMessage(null);
    // Optimistic: the note under the choice follows at once.
    setSummary({ ...before, deliveryChannel: next });
    try {
      const result = await setDeliveryChannel({ deliveryChannel: next });
      if (!mounted.current) return;
      if (result.ok) {
        setSummary(result.data);
        setMessage({ tone: "status", text: CHANNEL_COPY.saved });
      } else {
        setSummary(before);
        setMessage({ tone: "error", text: result.error });
      }
    } catch {
      if (mounted.current) {
        setSummary(before);
        setMessage({ tone: "error", text: CHANNEL_COPY.saveFailed });
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  async function activate() {
    if (pending || !summary.vapidPublicKey) return;
    setPending("activate");
    setMessage(null);
    let subscription: PushSubscription | null = null;
    try {
      // First thing after the tap: iOS only shows the permission prompt inside the gesture.
      const permission = await Notification.requestPermission();
      if (!mounted.current) return;
      if (permission !== "granted") {
        if (permission === "denied") {
          // The explanation replaces the key that had the focus: it goes to the section's title.
          focusAfterRender.current = "heading";
          setDevice("denied");
        } else {
          setMessage({ tone: "error", text: CHANNEL_COPY.device.activateFailed });
        }
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const key = urlBase64ToBytes(summary.vapidPublicKey);
      subscription = await registration.pushManager.getSubscription();
      // A subscription made with another key can never receive what this server sends.
      if (
        subscription &&
        !sameApplicationServerKey(subscription.options?.applicationServerKey, key)
      ) {
        await subscription.unsubscribe();
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      const json = subscription.toJSON();
      const result = await subscribePushDevice({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });
      if (!mounted.current) return;
      if (!result.ok) {
        // The server did not take it: leave the browser as it was before.
        await subscription.unsubscribe().catch(() => false);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      focusAfterRender.current = "deactivate";
      setSummary(result.data);
      setDevice("on");
      setMessage({ tone: "status", text: CHANNEL_COPY.device.activated });
    } catch {
      if (mounted.current) {
        setMessage({ tone: "error", text: CHANNEL_COPY.device.activateFailed });
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  async function deactivate() {
    if (pending) return;
    setPending("deactivate");
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const result = await unsubscribePushDevice({ endpoint: subscription.endpoint });
        if (!mounted.current) return;
        if (!result.ok) {
          setMessage({ tone: "error", text: result.error });
          return;
        }
        setSummary(result.data);
        // The server already stopped sending; the browser's own subscription goes too.
        await subscription.unsubscribe().catch(() => false);
      }
      if (!mounted.current) return;
      focusAfterRender.current = "activate";
      setDevice("off");
      setMessage({ tone: "status", text: CHANNEL_COPY.device.deactivated });
    } catch {
      if (mounted.current) {
        setMessage({ tone: "error", text: CHANNEL_COPY.device.deactivateFailed });
      }
    } finally {
      if (mounted.current) setPending(null);
    }
  }

  const effective = selectChannels({
    deliveryChannel: summary.deliveryChannel,
    hasPushDevices: summary.devices.length > 0,
    pushAvailable: summary.pushConfigured,
    telegramConnected: summary.telegramConnected,
  });
  const note = channelNote({
    deliveryChannel: summary.deliveryChannel,
    effective,
    devices: summary.devices.length,
  });

  const deviceText = !summary.pushConfigured
    ? CHANNEL_COPY.device.notConfigured
    : {
        checking: CHANNEL_COPY.device.checking,
        unsupported: CHANNEL_COPY.device.unsupported,
        needs_install: CHANNEL_COPY.device.needsInstall,
        denied: CHANNEL_COPY.device.denied,
        off: CHANNEL_COPY.device.off,
        on: CHANNEL_COPY.device.on,
      }[device];
  // A button only where it can work: installed or supported, configured, and not blocked.
  const canActivate = summary.pushConfigured && device === "off";
  const canDeactivate = device === "on";
  // The blocked ones explain themselves in the row; the button would be dead.
  const explained = device === "unsupported" || device === "needs_install" || device === "denied";

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      className="flex w-full max-w-100 flex-col gap-4"
    >
      <SectionLabel as="h2" id={headingId} tabIndex={-1} title={CHANNEL_COPY.title} />
      <p className="bo-text-body-sm text-text-secondary">{CHANNEL_COPY.intro}</p>

      <SegmentedControl
        mode="radio"
        touch
        label={CHANNEL_COPY.groupLabel}
        aria-describedby={noteId}
        options={OPTIONS}
        value={summary.deliveryChannel}
        onValueChange={chooseChannel}
      />
      <p id={noteId} className="bo-text-body-sm text-text-secondary">
        {note}
      </p>

      <SectionLabel as="h3" title={CHANNEL_COPY.device.title} />
      <div className="bo-list">
        <ListRow
          leading={<Icon icon={Smartphone} size="md" />}
          title="Push"
          subtitle={deviceText}
        />
      </div>

      {!summary.pushConfigured && summary.pushProblems.length > 0 ? (
        <ul className="bo-text-body-sm list-disc pl-5 text-text-secondary">
          {summary.pushProblems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {canDeactivate ? (
        <Key
          ref={deactivateRef}
          icon={BellOff}
          block
          variant="ghost"
          aria-disabled={pending !== null}
          onClick={deactivate}
        >
          {pending === "deactivate"
            ? CHANNEL_COPY.device.deactivating
            : CHANNEL_COPY.device.deactivate}
        </Key>
      ) : !explained && summary.pushConfigured && device !== "checking" ? (
        <Key
          ref={activateRef}
          icon={BellRing}
          block
          aria-disabled={pending !== null || !canActivate}
          aria-describedby={message?.tone === "error" ? errorId : undefined}
          onClick={activate}
        >
          {pending === "activate" ? CHANNEL_COPY.device.activating : CHANNEL_COPY.device.activate}
        </Key>
      ) : null}

      {summary.devices.length > 0 ? (
        <ul
          aria-label={CHANNEL_COPY.device.listLabel}
          className="bo-text-body-sm text-text-secondary"
        >
          {summary.devices.map((entry) => (
            <li key={entry.id}>
              {entry.label} · desde el {entry.sinceLabel}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Always rendered, so screen readers announce messages as soon as they appear. */}
      <p role="status" className="bo-text-body-sm min-h-6 text-text-secondary">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <div role="alert" aria-atomic="true">
        {message?.tone === "error" ? (
          <Lcd id={errorId} tag={<span aria-hidden>Push</span>} live={false}>
            {message.text}
          </Lcd>
        ) : null}
      </div>
    </section>
  );
}
