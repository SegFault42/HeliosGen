export interface WaveNodeState {
  pendingGenerate?: boolean;
  status?: string;
}

export type WaveDecision = "wait" | "advance" | "stop";

// Missing node (deleted mid-run) counts as settled and not failed.
// "wait": keep waiting. "advance": wave settled cleanly. "stop": a node failed, abort the pipeline.
export function decideWave(
  states: Array<WaveNodeState | undefined>,
  everActive: boolean,
  hasNextWave: boolean
): WaveDecision {
  const live = states.filter((s): s is WaveNodeState => !!s);
  const busy = (s: WaveNodeState) => s.status === "pending" || s.status === "running";
  const failed = live.some(s => s.status === "error" && !s.pendingGenerate);
  if (!everActive) {
    // Never reached pending/running: a failed node here would hang forever.
    return failed && !live.some(busy) ? "stop" : "wait";
  }
  if (live.some(s => s.pendingGenerate || busy(s))) return "wait";
  return failed && hasNextWave ? "stop" : "advance";
}
