import { Fragment } from "react";
import type { MessageStatus } from "@/lib/status";
import { FigureText } from "@/components/ui/figures";
import type { Phrase, Piece } from "./phrase";

/**
 * A figure keeps the word before it on its line ("in 9.17 s"), so a line
 * never ends on a preposition with the figure on the next. Returns the
 * phrase with that word moved out of the words piece, as `lead` of the figure.
 */
function bindFigures(phrase: Phrase): (Piece & { lead?: string })[] {
  const bound: (Piece & { lead?: string })[] = [];
  for (const piece of phrase) {
    const previous = bound.at(-1);
    const isFigure = piece.tone === "figure";
    const match = previous && !previous.tone ? /(\S+ )$/.exec(previous.text) : null;
    if (isFigure && previous && match?.[1]) {
      previous.text = previous.text.slice(0, -match[1].length);
      bound.push({ ...piece, lead: match[1] });
    } else {
      bound.push({ ...piece });
    }
  }
  return bound;
}

/**
 * A phrase set in its voices. Figures are tabular mono with their units in
 * the sentence's face (tabular Plex Sans inside the 30 px headline); codes
 * are mono and may break anywhere. The verdict is bold in its status's word ink when `status` is given.
 */
export function PhraseText({ phrase, status }: { phrase: Phrase; status?: MessageStatus }) {
  return bindFigures(phrase).map((piece, index) => {
    switch (piece.tone) {
      case "verdict":
        return (
          <b key={index} data-status={status} className="text-[color:var(--word,var(--ink))]">
            {piece.text}
          </b>
        );
      case "figure":
        return (
          <span key={index} className="whitespace-nowrap">
            {piece.lead}
            <FigureText text={piece.text} />
          </span>
        );
      case "code":
        // Codes can be long (a webhook URL, a carrier error), so they may break.
        return (
          <span key={index} className="num">
            {piece.text}
          </span>
        );
      case "attention":
        return (
          <span key={index} className="attn">
            {piece.text}
          </span>
        );
      default:
        return <Fragment key={index}>{piece.text}</Fragment>;
    }
  });
}
