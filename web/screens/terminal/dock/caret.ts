const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The caret index one grapheme from `index`: a flag, an emoji with a modifier or a letter with accents is one step. */
export function stepGrapheme(text: string, index: number, step: -1 | 1): number {
  for (const { index: start, segment } of graphemes.segment(text)) {
    const end = start + segment.length;
    if (step === 1 && end > index) return end;
    if (step === -1 && start < index && end >= index) return start;
  }
  return step === 1 ? text.length : 0;
}
