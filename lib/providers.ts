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

/**
 * Backends offered for each model. Kie.ai hosts everything; Grsai hosts the
 * Nano Banana and GPT Image families; Codex (ChatGPT's image engine — it can't
 * pick a specific GPT Image version) covers the GPT Image models; Azure needs an
 * Azure size map plus a per-model deployment configured.
 */
const AZURE_CAPABLE = new Set(IMAGE_MODELS.filter((m) => !!m.azureSizeMap).map((m) => m.id));
const GRSAI_CAPABLE = new Set(GRSAI_MODEL_IDS);
const CODEX_CAPABLE = new Set(IMAGE_MODELS.filter((m) => m.id.startsWith("gpt-image-")).map((m) => m.id));

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

/**
 * Whether codex-imagegen is installed and logged in on this host. Cached in
 * localStorage so the default provider can be resolved synchronously; refreshed
 * once per page load (listeners re-read on "aiui-providers-changed").
 */
const CODEX_READY_KEY = "aiui-codex-ready";
let codexCheckStarted = false;

function isCodexReady(): boolean {
  if (typeof window === "undefined") return false;
  if (!codexCheckStarted) {
    codexCheckStarted = true;
    fetch("/api/settings/codex-status")
      .then((r) => r.json())
      .then((d: { ready?: boolean }) => {
        const next = d.ready ? "1" : "0";
        if (localStorage.getItem(CODEX_READY_KEY) !== next) {
          localStorage.setItem(CODEX_READY_KEY, next);
          window.dispatchEvent(new CustomEvent("aiui-providers-changed"));
        }
      })
      .catch(() => { /* keep the cached value */ });
  }
  try { return localStorage.getItem(CODEX_READY_KEY) === "1"; } catch { return false; }
}

/** Backend used when the user hasn't picked one: Codex for GPT Image models when it's set up, else Kie.ai. */
export function defaultModelProvider(modelId: string): ProviderId {
  return CODEX_CAPABLE.has(modelId) && isCodexReady() ? "codex" : "kie";
}

export function getModelProvider(modelId: string): ProviderId {
  return loadModelProviders()[modelId] ?? defaultModelProvider(modelId);
}

/** Persists the backend for a single model, leaving the others untouched. */
export function setModelProvider(modelId: string, provider: ProviderId) {
  const map = loadModelProviders();
  saveModelProviders({ ...map, [modelId]: provider });
}


export function providersForModel(modelId: string): (typeof PROVIDERS)[number][] {
  return PROVIDERS.filter((p) =>
    p.id === "kie" ||
    (p.id === "grsai" && GRSAI_CAPABLE.has(modelId)) ||
    (p.id === "codex" && CODEX_CAPABLE.has(modelId)) ||
    (p.id === "azure" && AZURE_CAPABLE.has(modelId)),
  );
}

export function modelHasProviderChoice(modelId: string): boolean {
  return providersForModel(modelId).length > 1;
}
