import { cn } from "@/lib/cn";
import { LoadingState } from "@/components/ui/states";
import type { Headline, SentencePart } from "./headline";
import styles from "./overview.module.css";

/** `figureClass` sets the figures: tabular widths, in the face of the words around them. */
function Sentence({
  parts,
  figureClass,
}: {
  parts: readonly SentencePart[];
  figureClass?: string;
}) {
  return parts.map((part, index) => {
    if (part.kind === "verdict") return <b key={index}>{part.text}</b>;
    if (part.kind === "figure") {
      return (
        <span key={index} className={cn(figureClass, part.attention && "attn")}>
          {part.text}
        </span>
      );
    }
    return part.text;
  });
}

/**
 * The one display sentence of the page and the line under it. The sentence
 * changes every second under load, so only its verdict is announced, and
 * only when it changes.
 */
export function OverviewHeadline({ headline }: { headline: Headline }) {
  if (headline.state === "loading") {
    return (
      <div className="headline">
        <LoadingState
          label="Loading the gateway’s state"
          lines={3}
          widths={["96%", "88%", "52%"]}
        />
      </div>
    );
  }

  const verdict = headline.sentence.find((part) => part.kind === "verdict")?.text ?? "";

  return (
    <>
      <h1 className="headline">
        <Sentence parts={headline.sentence} figureClass="num" />
      </h1>
      <p role="status" className="sr-only">
        {verdict}
      </p>
      {headline.lede.length > 0 ? (
        <p className="lede">
          <Sentence parts={headline.lede} figureClass={styles.inlineFigure} />
        </p>
      ) : null}
    </>
  );
}
