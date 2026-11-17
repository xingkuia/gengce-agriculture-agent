const GUARANTEE_PATTERN =
  /保证增产|保证收益|稳赚|必定增产|每亩.{0,12}\d+\s*(毫升|克|ml|g)\b/i;

export function verifyGroundedText(text: string, evidence: string): boolean {
  const numbers = new Set(numericTokens(evidence));
  return (
    !numericTokens(text).some(value => !numbers.has(value)) &&
    !GUARANTEE_PATTERN.test(text)
  );
}

export function repairAgentText(
  text: string,
  evidence: string
): { text: string; removedNumbers: string[] } {
  const allowed = new Set(numericTokens(evidence));
  const removedNumbers = new Set<string>();
  const segments = text.match(/[^。！？；\n]+[。！？；]?|\n+/g) ?? [text];
  const repaired = segments
    .filter(segment => {
      const unsupported = numericTokens(segment).filter(value => !allowed.has(value));
      if (!unsupported.length) return true;
      unsupported.forEach(value => removedNumbers.add(value));
      return false;
    })
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: repaired, removedNumbers: [...removedNumbers] };
}

export function numericTokens(value: string): string[] {
  return (
    value
      .replace(/^\s*(?:\*\*)?\d+[.)、](?:\*\*)?\s*/gm, "")
      .match(/\d+(?:\.\d+)?/g) ?? []
  );
}
