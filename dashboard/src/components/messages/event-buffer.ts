import type { BatchEvent, MessageEvent } from "@/lib/api/schemas";
import { statusRank } from "@/lib/status";

const MAX_HELD = 5_000;

export interface HeldEvents {
  /** For each message, the event that is furthest along the pipeline. */
  messages: ReadonlyMap<string, MessageEvent>;
  batches: readonly BatchEvent[];
}

/**
 * Stream events that wait to be applied to the message list.
 *
 * The list applies events a few times a second instead of once per event, and
 * not at all while it is being fetched, so events have to wait somewhere. The
 * wait has no upper bound (a hidden tab, a request that hangs), so the buffer
 * has one: past MAX_HELD it stops holding events and reports an overflow, and
 * the list is fetched again instead.
 */
export class EventBuffer {
  private messages = new Map<string, MessageEvent>();
  private batches: BatchEvent[] = [];
  private overflowed = false;

  get isEmpty(): boolean {
    return this.messages.size === 0 && this.batches.length === 0 && !this.overflowed;
  }

  addMessage(event: MessageEvent): void {
    if (this.overflowed) return;
    const held = this.messages.get(event.id);
    // Events can arrive out of order. A status never moves backwards.
    if (held && statusRank(event.status) < statusRank(held.status)) return;
    if (!held && this.messages.size >= MAX_HELD) this.overflow();
    else this.messages.set(event.id, event);
  }

  addBatch(event: BatchEvent): void {
    if (this.overflowed) return;
    if (this.batches.length >= MAX_HELD) this.overflow();
    else this.batches.push(event);
  }

  /** Hand over what is held and start again empty. */
  drain(): { events: HeldEvents; overflowed: boolean } {
    const drained = {
      events: { messages: this.messages, batches: this.batches },
      overflowed: this.overflowed,
    };
    this.messages = new Map();
    this.batches = [];
    this.overflowed = false;
    return drained;
  }

  private overflow(): void {
    this.messages = new Map();
    this.batches = [];
    this.overflowed = true;
  }
}
