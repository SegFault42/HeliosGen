// Pure gallery decisions: which providers need the Kie key, and how long to poll a job.
import { IMAGE_MODELS, VIDEO_MODELS } from "./modelConfig";

type Routing = { apiInput?: { useFlow?: boolean; useGrok?: boolean; useHeyGenMcp?: boolean } };

/** Local-pool providers that never touch Kie. `selected` = aiui-model-providers entry ("kie" | "azure" | "codex"). */
export function needsKieKey(modelId: string, selected = "kie", azureConfigured = false): boolean {
  const m: Routing | undefined = IMAGE_MODELS.find((x) => x.id === modelId) ?? VIDEO_MODELS.find((x) => x.id === modelId);
  const a = m?.apiInput;
  if (a?.useFlow || a?.useGrok || a?.useHeyGenMcp) return false;
  if (selected === "codex") return false;
  if (selected === "azure" && azureConfigured) return false;
  return true;
}

export function canGenerate(o: { modelId: string; kieKeySet: boolean | null | undefined; selected?: string; azureConfigured?: boolean }): boolean {
  return o.kieKeySet !== false || !needsKieKey(o.modelId, o.selected, o.azureConfigured);
}

const POLL_INTERVAL_MS = 3_000;
const DEFAULT_DEADLINE_MS = 7.5 * 60_000;
const SLOW_DEADLINE_MS = 36 * 60_000; // Flow 20 min, HeyGen 30 min server-side + last iteration + mirror

/** Max poll iterations (3 s each) before the gallery gives up on a job. */
export function pollMaxIterations(modelId: string): number {
  const a: Routing["apiInput"] = (IMAGE_MODELS.find((x) => x.id === modelId) ?? VIDEO_MODELS.find((x) => x.id === modelId))?.apiInput;
  const slow = !!(a?.useFlow || a?.useHeyGenMcp);
  return Math.ceil((slow ? SLOW_DEADLINE_MS : DEFAULT_DEADLINE_MS) / POLL_INTERVAL_MS);
}
