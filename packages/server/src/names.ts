// Replaceable baseline, intentionally small. Also normalize common leetspeak.
export const BLOCKED_WORDS = ['fuck', 'shit', 'nigger', 'faggot', 'cunt'];
export function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (
    name.length < 2 ||
    name.length > 16 ||
    /[<>]/.test(name) ||
    [...name].some((c) => c.charCodeAt(0) < 32)
  )
    throw new Error(
      'Name must be 2–16 characters without control characters or angle brackets.',
    );
  const normalized = name.toLowerCase().replace(
    /[013457@$]/g,
    (c) =>
      ({
        '0': 'o',
        '1': 'i',
        '3': 'e',
        '4': 'a',
        '5': 's',
        '7': 't',
        '@': 'a',
        $: 's',
      })[c] ?? c,
  );
  if (BLOCKED_WORDS.some((w) => normalized.includes(w)))
    throw new Error('Choose another callsign.');
  return name;
}
export function uniqueName(name: string, existing: string[]): string {
  let result = name;
  let suffix = 2;
  while (existing.some((n) => n.toLowerCase() === result.toLowerCase())) {
    const tail = ` ${suffix++}`;
    result = name.slice(0, 16 - tail.length) + tail;
  }
  return result;
}
