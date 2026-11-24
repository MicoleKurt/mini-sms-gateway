"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { sendMessage, type SendMessageInput } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

export type Draft = Omit<SendMessageInput, "idempotencyKey">;

/** Two drafts with the same fingerprint are the same request to the gateway. */
export function fingerprintOf(draft: Draft): string {
  return JSON.stringify(draft);
}

/** 128 random bits as hex. Unlike crypto.randomUUID this also works on plain http. */
function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Sends a test message with an Idempotency-Key.
 *
 * The key belongs to the draft, not to one attempt. It is created when a
 * draft is first submitted and reused for every later submit of the same
 * draft: after a failure, where the first request may or may not have
 * arrived, and after a success, where a second click or a held Enter key
 * would otherwise be a second message. For a repeated key the gateway replays
 * its stored answer and neither creates nor charges anything.
 *
 * A changed draft gets a new key. To send the same draft again on purpose,
 * call `forgetKey` first.
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  const keyed = useRef<{ fingerprint: string; key: string } | null>(null);

  const send = useMutation({
    mutationFn: (draft: Draft) => {
      const fingerprint = fingerprintOf(draft);
      if (keyed.current?.fingerprint !== fingerprint) {
        keyed.current = { fingerprint, key: randomKey() };
      }
      return sendMessage({ ...draft, idempotencyKey: keyed.current.key });
    },
    onSuccess: () => {
      // The balance and the lists changed. The stream will say so too, but only while it is live.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tenants });
      void queryClient.invalidateQueries({ queryKey: queryKeys.messageLists });
    },
  });

  function forgetKey() {
    keyed.current = null;
  }

  return { send, forgetKey };
}
