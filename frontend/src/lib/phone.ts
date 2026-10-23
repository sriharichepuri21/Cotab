/**
 * US phone numbers on screen. The server decides what's valid and stores
 * "+14155550123"; these only make typing and reading them friendlier.
 */

/** Digits of a US number without the leading country code 1. */
function nationalDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  return (digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits).slice(0, 10);
}

/** Formats as it's typed: "4155" -> "(415) 5", "4155550123" -> "(415) 555-0123". */
export function formatUsPhone(input: string): string {
  const d = nationalDigits(input);
  if (d.length === 0) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** True once there are enough digits to be worth sending. */
export const looksComplete = (input: string) => nationalDigits(input).length === 10;

/** "+14155550123" -> "(415) 555-0123". */
export const prettyPhone = (e164: string | null | undefined) =>
  e164 ? formatUsPhone(e164.replace(/^\+1/, "")) : "";
