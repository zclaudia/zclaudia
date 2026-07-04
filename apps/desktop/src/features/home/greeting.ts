/** Time-of-day greeting for the populated home header. Framing the page as a
 *  personal home ("Good evening") rather than a welcome mat resolves the tonal
 *  clash with the usage dashboard below it. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}
