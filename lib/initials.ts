/**
 * Initials for an avatar fallback, when there is no picture to show.
 *
 * Takes the first letter of the first and last word, which reads correctly for
 * "Ada Lovelace" and for a single-word name alike, and works the same in
 * Arabic — the letters come from the name itself rather than a
 * transliteration.
 *
 * Iterated by code point (`[...word]`), not `charAt`: an emoji or an
 * astral-plane character would otherwise be split into half a surrogate pair
 * and render as a replacement glyph.
 *
 * Pure and framework-free on purpose: the server component that renders the
 * profile header and the client component that renders the header menu both
 * need it, and a helper exported from a `"use client"` module cannot be called
 * during a server render.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "";
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? "") : "";
  return (first + last).toUpperCase();
}
