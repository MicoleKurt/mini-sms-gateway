import Link from "next/link";
import type { ReactNode } from "react";
import type { MessageDetail } from "@/lib/api/schemas";
import { CopyButton } from "@/components/ui/copy-button";
import { Section } from "@/components/ui/section";
import { utcDayLabel } from "@/components/messages/list-format";
import { detailHeadline, journeyNote, summaryLine } from "./headline";
import { PhraseText } from "./phrase-text";

/** The way back to the list, for the margin column. */
export function BackToMessages() {
  return (
    <Link href="/messages" className="text-ink-2">
      Back to messages
    </Link>
  );
}

/** The opening section of a message's page: its ID, the headline and the lines under it. */
export function DetailHeader({ detail, notice }: { detail: MessageDetail; notice?: ReactNode }) {
  const { message } = detail;
  const note = journeyNote(detail);

  return (
    <Section
      ruled={false}
      aside={
        <>
          {/* Down to the baseline of the ID line, which the Copy button makes taller. */}
          <p className="pt-1">
            <BackToMessages />
          </p>
          <p className="sec-context mt-3">
            Accepted {utcDayLabel(message.created_at)}. Times on this page are UTC.
          </p>
        </>
      }
    >
      {notice}
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3.5">
        <span className="num break-all text-ink-2">{message.id}</span>
        <CopyButton value={message.id} label="Copy ID" />
      </div>
      <h1 className="headline headline-wide text-balance">
        <PhraseText phrase={detailHeadline(detail)} status={message.status} />
      </h1>
      {note ? (
        <p className="lede text-ink">
          <PhraseText phrase={note} />
        </p>
      ) : null}
      <p className={note ? "mt-2 text-ink-2" : "lede"}>
        <PhraseText phrase={summaryLine(detail)} />
      </p>
    </Section>
  );
}
