const MAX_PATTERN_LENGTH = 128;
const MAX_REPETITION = 10_000;

const consumeQuantifier = (body: string, start: number): number | undefined => {
  const marker = body[start];
  if (marker === "?" || marker === "*" || marker === "+") return start + 1;
  if (marker !== "{") return start;

  const end = body.indexOf("}", start + 1);
  if (end === -1) return undefined;
  const match = /^(\d+)(?:,(\d+))?$/.exec(body.slice(start + 1, end));
  if (!match) return undefined;
  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (minimum > maximum || maximum > MAX_REPETITION) return undefined;
  return end + 1;
};

export const patternLooksSafe = (pattern: string): boolean => {
  if (
    pattern.length > MAX_PATTERN_LENGTH ||
    !pattern.startsWith("^") ||
    !pattern.endsWith("$")
  ) {
    return false;
  }

  const body = pattern.slice(1, -1);
  let quantifierCount = 0;
  for (let index = 0; index < body.length; ) {
    const token = body[index];
    if (token === "\\") {
      const escaped = body[index + 1];
      if (escaped === undefined || /[1-9]/.test(escaped)) return false;
      index += 2;
    } else if (token === "[") {
      let end = index + 1;
      if (body[end] === "^") end += 1;
      const contentStart = end;
      while (end < body.length && body[end] !== "]") {
        if (body[end] === "\\" && end + 1 < body.length) end += 1;
        end += 1;
      }
      if (end === body.length || end === contentStart) return false;
      index = end + 1;
    } else {
      if (token === undefined || "()|*+{}?^$".includes(token)) return false;
      index += 1;
    }

    const next = consumeQuantifier(body, index);
    if (next === undefined) return false;
    if (next !== index) quantifierCount += 1;
    if (quantifierCount > 1) return false;
    index = next;
  }
  return true;
};
