// The hosting platform rejects requests above about 4.5 MB, so uploads stop just below it.
export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_UPLOAD_LABEL = '4 MB';

export const EXTRACT_LIMIT = 60_000;
export const COACH_LIMIT = 20_000;
export const FEEDBACK_LIMIT = 40_000;

export type Coverage = { totalChars: number; readChars: number; complete: boolean };

export function coverageOf(text: string, limit: number): Coverage {
  const totalChars = text.length;
  const readChars = Math.min(totalChars, limit);
  return { totalChars, readChars, complete: readChars === totalChars };
}

export const count = (n: number) => n.toLocaleString('en');

/** The note added to a prompt, only when text was shortened. */
export const shortenedNote = (c: Coverage) =>
  c.complete ? '' : `\nOnly the first ${c.readChars} of ${c.totalChars} characters are included. Judge only this part, and say so. Do not treat later content as missing.`;
