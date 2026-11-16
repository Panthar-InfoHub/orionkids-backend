/**
 * OrionKids Centralized Child Name Formatting Utility (Backend)
 *
 * Ensures consistent, professional capitalization for child names across all
 * OrionKids backend reports, PDF generators, AI prompts, emails, and controllers.
 *
 * Requirements:
 * - Handle null and undefined safely.
 * - Handle empty strings safely.
 * - Remove unnecessary leading and trailing whitespace.
 * - Normalize repeated spaces.
 * - Capitalize the first letter of each name part.
 * - Preserve meaningful separators such as hyphens and apostrophes where practical.
 * - Handle multi-word names.
 * - Avoid converting all names to uppercase.
 * - Avoid producing undefined, null or empty labels in reports/PDFs.
 */

/** Regex to match word-internal punctuation separators: hyphens, apostrophes (straight & curly), dots */
const SEPARATOR_REGEX = /([.'’\-\u2013\u2014])/;

/**
 * Capitalizes a single sub-token: first Unicode code point uppercase, rest lowercase.
 */
function capitalizeSubPart(part: string): string {
  if (!part) return "";
  const chars = Array.from(part);
  if (chars.length === 0) return "";
  const first = chars[0]!.toLocaleUpperCase();
  const rest = chars.slice(1).join("").toLocaleLowerCase();
  return first + rest;
}

/**
 * Formats a single word token, preserving internal separators like hyphens, apostrophes, and dots.
 */
function formatWord(word: string): string {
  if (!word) return "";
  return word
    .split(SEPARATOR_REGEX)
    .map((token) => (SEPARATOR_REGEX.test(token) ? token : capitalizeSubPart(token)))
    .join("");
}

/**
 * Formats a child's name with consistent, professional capitalization.
 *
 * @param name The raw child name (string, null, or undefined)
 * @param fallback Optional fallback string if the formatted name would be empty (e.g. "Your Child", "Child")
 * @returns Consistently capitalized display name, or fallback, or empty string.
 */
export function formatChildName(
  name: string | null | undefined,
  fallback?: string
): string {
  if (typeof name !== "string") {
    return fallback ? formatChildName(fallback) : "";
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return fallback ? formatChildName(fallback) : "";
  }

  // Normalize multiple spaces into single space and format each word part
  const words = trimmed.split(/\s+/);
  const formatted = words.map(formatWord).join(" ");

  return formatted || (fallback ? formatChildName(fallback) : "");
}

/**
 * Returns the child's formatted first name (first word of the formatted name).
 *
 * @param name The raw child name
 * @param fallback Optional fallback if the name is missing (defaults to "Child")
 */
export function formatChildFirstName(
  name: string | null | undefined,
  fallback: string = "Child"
): string {
  const formatted = formatChildName(name);
  if (!formatted) {
    return formatChildName(fallback).split(/\s+/)[0] || "Child";
  }
  const firstWord = formatted.split(/\s+/)[0];
  return firstWord || formatChildName(fallback).split(/\s+/)[0] || "Child";
}

