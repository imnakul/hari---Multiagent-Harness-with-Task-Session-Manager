type InputPart = { text: string; pasted: boolean };

/** Separates a prompt from the attachment paths Interactive appends to it. */
export const INTERACTIVE_ATTACHMENTS_HEADER =
  "\n\nRead these attached files using your tools:\n";

/**
 * Interactive types a prompt's first letter and pastes the rest; the native
 * transcript then stores it folded: `T\n\n<pasted_content id="x">\nhis is…\n</pasted_content id="x">`.
 * Return the prompt as sent. Only that exact single-fold shape is unfolded.
 */
export function unfoldInteractivePaste(text: string): string {
  const folded =
    /^([^<]{0,8}?)\n{0,2}<pasted_content id="([A-Za-z0-9_-]{1,64})">\n([\s\S]*?)\n?<\/pasted_content(?: id="\2")?>\s*$/.exec(
      text,
    );
  return folded ? folded[1] + folded[3] : text;
}

/** Mirror interactive_delivery::paste_payload without changing the submitted text. */
function inputParts(text: string): InputPart[] {
  const offset = text.search(/[\p{Alphabetic}\p{Number}]/u);
  if (offset < 0) return [{ text, pasted: true }];
  const end = offset + String.fromCodePoint(text.codePointAt(offset)!).length;
  return [
    { text: text.slice(0, offset), pasted: true },
    { text: text.slice(offset, end), pasted: false },
    { text: text.slice(end), pasted: true },
  ].filter((part) => part.text.length > 0);
}

function partEnds(actual: string, from: number, part: InputPart): number[] {
  const ends: number[] = [];
  if (actual.startsWith(part.text, from)) ends.push(from + part.text.length);
  if (!part.pasted) return ends;
  // Claude can put blank-line separators around a folded paste. Match the
  // expected body verbatim, including literal user markup; never strip tags
  // globally or accept a truncated/changed native prompt.
  for (const separator of ["", "\n", "\n\n"]) {
    if (!actual.startsWith(separator, from)) continue;
    const start = from + separator.length;
    const header = /^<pasted_content id="([A-Za-z0-9_-]{1,64})">\n/.exec(
      actual.slice(start, start + 100),
    );
    if (!header) continue;
    const body = start + header[0].length;
    const close = body + part.text.length;
    if (!actual.startsWith(part.text, body)) continue;
    // The native CLI repeats the opening ID in its closing tag. A paste
    // ending in a newline already supplies the delimiter before that tag.
    // Retain the earlier plain-tag representation without weakening the body
    // comparison or accepting a mismatched closing ID.
    const closings = [
      `${part.text.endsWith("\n") ? "" : "\n"}</pasted_content id="${header[1]}">`,
      "\n</pasted_content>",
    ];
    for (const closing of closings) {
      if (!actual.startsWith(closing, close)) continue;
      const end = close + closing.length;
      for (const trailing of ["", "\n", "\n\n"])
        if (actual.startsWith(trailing, end)) ends.push(end + trailing.length);
    }
  }
  return ends;
}

function matchesParts(actual: string, parts: InputPart[]): boolean {
  let positions = new Set([0]);
  for (const part of parts) {
    const next = new Set<number>();
    for (const from of positions)
      for (const end of partEnds(actual, from, part)) next.add(end);
    if (!next.size) return false;
    positions = next;
  }
  return positions.has(actual.length);
}

/** Confirm only the exact prompt or Claude's equivalent of our known paste parts. */
export function interactivePromptMatches(
  expected: string,
  actual: unknown,
): boolean {
  if (typeof actual !== "string") return false;
  if (actual === expected) return true;
  if (!expected || expected === "/compact") return false;
  return matchesParts(actual, inputParts(expected));
}

/**
 * The prompt as sent except for its one typed letter: doubled (the letter
 * landed, then a repaste after a dropped paste typed it again) or missing (a
 * repaste sends only the pasted parts). Only our own delivery explains either,
 * so this counts as delivered instead of "different input" (fork, L-187).
 * Every pasted part must still match exactly.
 */
export function interactivePromptNearlyMatches(
  expected: string,
  actual: unknown,
): boolean {
  if (typeof actual !== "string" || !expected || expected === "/compact")
    return false;
  const parts = inputParts(expected);
  const typed = parts.findIndex((part) => !part.pasted);
  if (typed < 0) return false;
  const letter = parts[typed].text;
  const before = parts.slice(0, typed);
  const after = parts.slice(typed + 1);
  const pasted = [...before, ...after];
  const variants: InputPart[][] = [
    [...before, { text: letter + letter, pasted: false }, ...after],
    pasted,
  ];
  // Two adjacent pastes may reach Claude as one.
  if (pasted.length === 2)
    variants.push([{ text: pasted[0].text + pasted[1].text, pasted: true }]);
  return variants.some(
    (variant) => variant.length > 0 && matchesParts(actual, variant),
  );
}
