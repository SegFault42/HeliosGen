// ─────────────────────────────────────────────────────────────────────────────
// PROVIDERS — single source of truth for per-model backend selection
// (Kie.ai / Grsai / Azure Foundry / Codex CLI), shared by the Settings modal, the
// workflow GenerateNode, and the gallery generation composer.
// ─────────────────────────────────────────────────────────────────────────────
import { IMAGE_MODELS } from "@/lib/modelConfig";
import { GRSAI_MODEL_IDS } from "@/lib/grsaiModels";

export const PROVIDERS = [
  { id: "kie",   label: "Kie.ai" },
  { id: "grsai", label: "Grsai" },
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
 * Backends offered for each model. Kie.ai hosts everything; Grsai hosts the
 * Nano Banana and GPT Image families; Azure and Codex are image-only and exist
 * only for models with an Azure size map (Azure additionally needs a per-model
 * deployment configured).
 */
const AZURE_CAPABLE = new Set(IMAGE_MODELS.filter((m) => !!m.azureSizeMap).map((m) => m.id));
const GRSAI_CAPABLE = new Set(GRSAI_MODEL_IDS);

export function providersForModel(modelId: string): (typeof PROVIDERS)[number][] {
  return PROVIDERS.filter((p) =>
    p.id === "kie" ||
    (p.id === "grsai" && GRSAI_CAPABLE.has(modelId)) ||
    ((p.id === "azure" || p.id === "codex") && AZURE_CAPABLE.has(modelId)),
  );
}

export function modelHasProviderChoice(modelId: string): boolean {
  return providersForModel(modelId).length > 1;
}
