// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS — single source of truth for per-model backend selection
// (Kie.ai / Higgsfield / Azure Foundry / Codex CLI), shared by Settings and nodes.
// ─────────────────────────────────────────────────────────────────────────────
import { IMAGE_MODELS } from "@/lib/modelConfig";

export const PROVIDERS = [
  { id: "kie",   label: "Kie.ai" },
  { id: "higgsfield", label: "Higgsfield" },
  { id: "azure", label: "Azure Foundry" },
  { id: "codex", label: "Codex CLI" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

const STORAGE_KEY = "aiui-model-providers";

export function loadModelProviders(): Record<string, ProviderId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveModelProviders(map: Record<string, ProviderId>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent("aiui-providers-changed"));
  } catch { /* noop */ }
}

export function getModelProvider(modelId: string): ProviderId {
  return loadModelProviders()[modelId] ?? "kie";
}

/** Persists the backend for a single model, leaving the others untouched. */
export function setModelProvider(modelId: string, provider: ProviderId) {
  const map = loadModelProviders();
  saveModelProviders({ ...map, [modelId]: provider });
}

/**
 * Models with more than one backend to choose from. Azure/Codex are image-only;
 * Higgsfield is supported only for Seedance 2.0 text-to-video.
 */
const MULTI_PROVIDER_MODEL_IDS = new Set(
  [...IMAGE_MODELS.filter((m) => !!m.azureSizeMap).map((m) => m.id), "seedance-2"],
);

export function modelHasProviderChoice(modelId: string): boolean {
  return MULTI_PROVIDER_MODEL_IDS.has(modelId);
}
