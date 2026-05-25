export function useGeneratingPhase(busy: boolean): string {
  return busy ? "Generating…" : "";
}
