/**
 * TABBY in giant glass letters, in the logo's mint: each letter rises in turn,
 * then a band of light keeps passing across the word.
 */
export function BigWord({ word }: { word: string }) {
  return (
    <p className="bigword" aria-hidden="true">
      {Array.from(word).map((ch, i) => (
        <span key={i} style={{ ["--i" as string]: i }} data-ch={ch}>
          {ch}
        </span>
      ))}
    </p>
  );
}
