"use client";

import type { ReactNode } from "react";
import { usePrices, useTenants } from "@/lib/api/hooks";
import type { Message } from "@/lib/api/schemas";
import { formatAmount } from "@/lib/format";
import { findPrice } from "@/lib/pricing";
import { Property, PropertyList } from "@/components/ui/facts-list";
import { Money } from "@/components/ui/figures";

const ENCODING_LABEL = { GSM7: "GSM-7", UCS2: "UCS-2" } as const;

/** A value in mono, or a dimmed "none" when the record has none. IDs break anywhere to fill the line. */
function Mono({ value }: { value: string | null }) {
  return value === null ? (
    <span className="zero">none</span>
  ) : (
    <span className="num break-all">{value}</span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <small className="ml-1.5">{children}</small>;
}

/**
 * The stored facts of a message, for the column beside its history. The
 * tenant's slug and the destination's country come from the tenants and
 * prices lists, and are left out until those have loaded.
 */
export function MessageFacts({ message }: { message: Message }) {
  const tenants = useTenants();
  const prices = usePrices();
  const slug = tenants.data?.find((tenant) => tenant.id === message.tenant_id)?.slug;
  const price = prices.data ? findPrice(prices.data, message.to) : null;
  const segments = message.segments === 1 ? "1 segment" : `${message.segments} segments`;
  const perSegment = Math.round(message.cost_micros / message.segments);

  return (
    <aside aria-labelledby="message-facts">
      <h2 id="message-facts" className="lbl border-b border-rule-strong pb-[7px] text-ink">
        Message
      </h2>
      <PropertyList>
        <Property label="Tenant">
          {message.tenant_name}
          {slug ? (
            <Note>
              <span className="num">{slug}</span>
            </Note>
          ) : null}
        </Property>
        <Property label="To">
          <span className="num">{message.to}</span>
          {price ? (
            <Note>
              <span className="num">{price.prefix}</span> {price.country}
            </Note>
          ) : null}
        </Property>
        <Property label="From">
          <Mono value={message.from} />
        </Property>
        <Property label="Text">
          <blockquote className="quote">{message.text}</blockquote>
          <small className="mt-1 block">
            {Array.from(message.text).length} characters · {ENCODING_LABEL[message.encoding]} ·{" "}
            {segments}
          </small>
        </Property>
        <Property label="Cost">
          <Money micros={message.cost_micros} />
          <Note>
            {message.currency} · <span className="num">{formatAmount(perSegment)}</span> a segment
          </Note>
        </Property>
        <Property label="Attempts">
          <span className="num">{message.attempts}</span>
          <Note>
            <span className={message.ambiguous_attempts > 0 ? "attn" : undefined}>
              {message.ambiguous_attempts} without an answer
            </span>
          </Note>
        </Property>
        <Property label="Carrier ID">
          <Mono value={message.carrier_id} />
        </Property>
        <Property label="Client ref">
          <Mono value={message.client_ref} />
        </Property>
        <Property label="Batch">
          <Mono value={message.batch_id} />
        </Property>
        <Property label="Failure">
          <Mono value={message.failure_reason} />
        </Property>
      </PropertyList>
    </aside>
  );
}
