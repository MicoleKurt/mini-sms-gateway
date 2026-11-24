import type { z } from "zod";
import {
  batchEventSchema,
  messageEventSchema,
  statsEventSchema,
  type BatchEvent,
  type MessageEvent,
  type StatsEvent,
} from "@/lib/api/schemas";

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface LiveEventMap {
  message: MessageEvent;
  batch: BatchEvent;
  stats: StatsEvent;
}

export type LiveEventType = keyof LiveEventMap;

type Handler<Type extends LiveEventType> = (event: LiveEventMap[Type]) => void;

const EVENT_SCHEMAS: { [Type in LiveEventType]: z.ZodType<LiveEventMap[Type]> } = {
  message: messageEventSchema,
  batch: batchEventSchema,
  stats: statsEventSchema,
};

const EVENT_TYPES = Object.keys(EVENT_SCHEMAS) as LiveEventType[];

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;

// The gateway sends a "stats" event every second. This much silence means the
// stream is dead even if the socket still looks open (a stalled proxy, a
// laptop that slept), so it is treated like an error.
const SILENCE_LIMIT_MS = 10_000;

/** Exponential backoff with jitter: between half of the step and the full step. */
export function backoffDelay(failures: number, random: () => number = Math.random): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** failures);
  return step / 2 + random() * (step / 2);
}

/**
 * The one EventSource of the app.
 *
 * The browser's own EventSource reconnect has a fixed delay and gives up on a
 * non-200 answer (which is what the proxy returns while the gateway is down),
 * so this class closes the source on any error and opens a new one itself.
 */
export class LiveConnection {
  private source: EventSource | null = null;
  private state: ConnectionState = "connecting";
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly stateListeners = new Set<() => void>();
  private readonly invalidTypesReported = new Set<LiveEventType>();
  private readonly handlers: { [Type in LiveEventType]: Set<Handler<Type>> } = {
    message: new Set(),
    batch: new Set(),
    stats: new Set(),
  };

  /**
   * `onGapClosed` runs every time the stream opens. Whatever was read over
   * REST before that moment may lack events: on a reconnect the ones sent
   * during the gap, on the first open the ones sent between the first REST
   * answers and the start of the subscription.
   */
  constructor(
    private readonly url: string,
    private readonly onGapClosed: () => void,
  ) {}

  start(): void {
    this.open();
  }

  stop(): void {
    this.close();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.failures = 0;
    this.setState("connecting");
  }

  getState = (): ConnectionState => this.state;

  subscribeState = (listener: () => void): (() => void) => {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  };

  on<Type extends LiveEventType>(type: Type, handler: Handler<Type>): () => void {
    const handlers: Set<Handler<Type>> = this.handlers[type];
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  private open(): void {
    const source = new EventSource(this.url);
    this.source = source;

    source.onopen = () => {
      this.failures = 0;
      this.setState("live");
      this.watchForSilence();
      this.onGapClosed();
    };
    source.onerror = () => this.retry();

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, (event) => {
        this.watchForSilence();
        this.dispatch(type, event.data);
      });
    }
  }

  private close(): void {
    this.source?.close();
    this.source = null;
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }

  private retry(): void {
    this.close();
    this.setState("reconnecting");
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, backoffDelay(this.failures));
    this.failures += 1;
  }

  private watchForSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.retry(), SILENCE_LIMIT_MS);
  }

  private dispatch<Type extends LiveEventType>(type: Type, raw: string): void {
    const event = this.parse(type, raw);
    if (!event) return;
    const handlers: Set<Handler<Type>> = this.handlers[type];
    for (const handler of handlers) handler(event);
  }

  private parse<Type extends LiveEventType>(type: Type, raw: string): LiveEventMap[Type] | null {
    const schema: z.ZodType<LiveEventMap[Type]> = EVENT_SCHEMAS[type];
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
    }
    const parsed = schema.safeParse(json);
    if (parsed.success) return parsed.data;
    // The stream is a best-effort view on top of the REST data, so one bad
    // event is dropped. It is reported once per type to keep the console usable.
    if (!this.invalidTypesReported.has(type)) {
      this.invalidTypesReported.add(type);
      console.error(
        `Dropped a "${type}" stream event that does not match docs/API.md.`,
        parsed.error,
      );
    }
    return null;
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener();
  }
}
