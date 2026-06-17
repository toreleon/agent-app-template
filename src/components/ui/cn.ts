/**
 * Tiny class-name combiner. Filters out falsy values and joins with a space.
 * Kept dependency-light (no clsx/tailwind-merge) per the Chat-UI brief.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
