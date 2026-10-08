// A fake Telegram Bot API on localhost, for tests (SPEC-reminders "TelegramClient ... TELEGRAM_API_BASE"):
// the unit tests of the client, the integration tests of the engine and the webhook, and the E2E
// of Ajustes all point `TELEGRAM_API_BASE` at it, so the production code has no test branches.
//
// - `calls` records every Bot API request (`/bot<token>/<method>` with its JSON body).
// - By default `sendMessage` answers `{ ok: true, result: { message_id } }` and every other method
//   `{ ok: true, result: true }`; `queue(method, …)` makes the next calls fail the way Telegram does.
// - A tiny control API over HTTP (`/__calls`, `/__reset`, `/__queue`, `/__health`) lets a test that
//   runs in another process (Playwright, with the app started by `webServer`) read and steer it.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedCall = { method: string; token: string; body: Record<string, unknown> };

export type QueuedResponse = {
  /** HTTP status; the Bot API repeats it as `error_code`. */
  status: number;
  /** Extra body fields, e.g. `{ parameters: { retry_after: 3 } }`. */
  extra?: Record<string, unknown>;
};

export type FakeTelegram = {
  /** `http://127.0.0.1:<port>`: the value for `TELEGRAM_API_BASE`. */
  url: string;
  port: number;
  calls: RecordedCall[];
  /** The next `times` calls to `method` fail with `response`. */
  queue(method: string, response: QueuedResponse, times?: number): void;
  reset(): void;
  close(): Promise<void>;
};

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const FIRST_MESSAGE_ID = 1000;

const DESCRIPTIONS: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden: bot was blocked by the user",
  404: "Not Found",
  429: "Too Many Requests",
  500: "Internal Server Error",
};

export async function startFakeTelegram(port = 0): Promise<FakeTelegram> {
  const calls: RecordedCall[] = [];
  const queued = new Map<string, QueuedResponse[]>();
  let nextMessageId = FIRST_MESSAGE_ID;

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake");
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };

    // Control API.
    if (url.pathname === "/__health") return send(200, { ok: true });
    if (url.pathname === "/__calls") return send(200, calls);
    if (url.pathname === "/__reset") {
      calls.length = 0;
      queued.clear();
      nextMessageId = FIRST_MESSAGE_ID;
      return send(200, { ok: true });
    }
    if (url.pathname === "/__queue" && request.method === "POST") {
      const body = (await readJson(request)) as {
        method: string;
        response: QueuedResponse;
        times?: number;
      };
      const list = queued.get(body.method) ?? [];
      for (let index = 0; index < (body.times ?? 1); index++) list.push(body.response);
      queued.set(body.method, list);
      return send(200, { ok: true });
    }

    // Bot API: /bot<token>/<method>
    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    if (!match) return send(404, { ok: false, error_code: 404, description: "Not Found" });
    const [, token, method] = match;
    calls.push({ method, token, body: await readJson(request) });

    const failure = queued.get(method)?.shift();
    if (failure) {
      return send(failure.status, {
        ok: false,
        error_code: failure.status,
        description: DESCRIPTIONS[failure.status] ?? "Error",
        ...failure.extra,
      });
    }
    if (method === "sendMessage") {
      return send(200, { ok: true, result: { message_id: nextMessageId++ } });
    }
    return send(200, { ok: true, result: true });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actualPort = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    calls,
    queue(method, response, times = 1) {
      const list = queued.get(method) ?? [];
      for (let index = 0; index < times; index++) list.push(response);
      queued.set(method, list);
    },
    reset() {
      calls.length = 0;
      queued.clear();
      nextMessageId = FIRST_MESSAGE_ID;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
