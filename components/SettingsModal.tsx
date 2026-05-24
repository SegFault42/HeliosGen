"use client";
import React, { useEffect, useRef, useState } from "react";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { MODEL_GROUPS } from "@/lib/models";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";

/* ─── Provider options ──────────────────────────────────────────────────────── */

export const PROVIDERS = [
  { id: "kie",   label: "Kie.ai" },
  { id: "azure", label: "Azure Foundry" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

/* ─── Persistence ───────────────────────────────────────────────────────────── */

const STORAGE_KEY            = "aiui-model-providers";
const AZURE_DEPLOYS_KEY      = "aiui-azure-endpoints";       // per-model deployment names
const AZURE_BASE_KEY         = "aiui-azure-base-url";        // global Foundry base URL
const AZURE_TEXT_DEPLOY_KEY  = "aiui-azure-text-deployment"; // text model deployment (URL path)
const AZURE_TEXT_MODEL_KEY   = "aiui-azure-text-model";      // text model name (request body)

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
  const map = loadModelProviders();
  return map[modelId] ?? "kie";
}

/** Per-model deployment name map (e.g. { "gpt-image-2": "gpt-image-2" }). */
export function loadAzureEndpoints(): Record<string, string> {
  try {
    const raw = localStorage.getItem(AZURE_DEPLOYS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveAzureEndpoints(map: Record<string, string>) {
  try {
    localStorage.setItem(AZURE_DEPLOYS_KEY, JSON.stringify(map));
  } catch { /* noop */ }
}

/** Returns the deployment name for a given model, or "" if unset. */
export function getAzureDeployment(modelId: string): string {
  return loadAzureEndpoints()[modelId] ?? "";
}

/** Global Azure Cognitive Services base URL (shared across all models). */
export function loadAzureBaseUrl(): string {
  try {
    return localStorage.getItem(AZURE_BASE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAzureBaseUrl(url: string) {
  try {
    localStorage.setItem(AZURE_BASE_KEY, url);
  } catch { /* noop */ }
}

/** @deprecated renamed — use getAzureDeployment(). Kept for backwards compat. */
export const getAzureEndpoint = getAzureDeployment;

/** Deployment name — used in the URL path (defaults to "auto-model"). */
export function loadAzureTextDeployment(): string {
  try {
    return localStorage.getItem(AZURE_TEXT_DEPLOY_KEY) ?? "auto-model";
  } catch {
    return "auto-model";
  }
}

export function saveAzureTextDeployment(name: string) {
  try {
    localStorage.setItem(AZURE_TEXT_DEPLOY_KEY, name);
  } catch { /* noop */ }
}

/** Model name — passed in the request body (defaults to "model-router"). */
export function loadAzureTextModelName(): string {
  try {
    return localStorage.getItem(AZURE_TEXT_MODEL_KEY) ?? "model-router";
  } catch {
    return "model-router";
  }
}

export function saveAzureTextModelName(name: string) {
  try {
    localStorage.setItem(AZURE_TEXT_MODEL_KEY, name);
  } catch { /* noop */ }
}

/* ─── Nav items ─────────────────────────────────────────────────────────────── */

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

type NavId = "api-keys" | "image-models" | "video-models" | "text-models" | "debug";

const NAV_BASE: { id: NavId; label: string; icon: React.ReactNode }[] = [
  {
    id: "api-keys",
    label: "API Keys",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="15" r="4" />
        <path d="m11.31 11.31 5.19-5.19" />
        <path d="m17 5 1.5 1.5" />
        <path d="m14 8 1.5 1.5" />
      </svg>
    ),
  },
  {
    id: "image-models",
    label: "Image Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </svg>
    ),
  },
  {
    id: "video-models",
    label: "Video Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m22 8-6 4 6 4V8z" />
        <rect x="2" y="6" width="14" height="12" rx="2" />
      </svg>
    ),
  },
  {
    id: "text-models",
    label: "Text Models",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
];

const DEBUG_NAV_ITEM: { id: NavId; label: string; icon: React.ReactNode } = {
  id: "debug",
  label: "Debug",
  icon: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
};

const NAV = IS_DEBUG ? [...NAV_BASE, DEBUG_NAV_ITEM] : NAV_BASE;

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface SettingsModalProps {
  onClose: () => void;
}

/* ─── Toggle ─────────────────────────────────────────────────────────────────── */

function ProviderToggle({
  modelId,
  value,
  onChange,
}: {
  modelId: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: "rgba(255,255,255,0.04)",
        borderRadius: "8px",
        padding: "3px",
        gap: "2px",
        border: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}
    >
      {PROVIDERS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            id={`provider-${modelId}-${p.id}`}
            onClick={() => onChange(p.id)}
            style={{
              padding: "4px 10px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.01em",
              transition: "background 140ms ease, color 140ms ease",
              background: active ? "rgba(255,255,255,0.1)" : "transparent",
              color: active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.32)",
              whiteSpace: "nowrap",
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Model row ─────────────────────────────────────────────────────────────── */

function ModelRow({
  id,
  name,
  providerLabel,
  category,
  value,
  onChange,
  azureSupported,
}: {
  id: string;
  name: string;
  providerLabel: string;
  category: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
  azureSupported?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "11px 16px",
        borderRadius: "10px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {/* Labels */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "rgba(255,255,255,0.85)",
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "rgba(255,255,255,0.28)",
            marginTop: "2px",
          }}
        >
          {providerLabel} · {category}
        </div>
      </div>

      {/* Provider toggle — only for Azure-supported models */}
      {azureSupported && <ProviderToggle modelId={id} value={value} onChange={onChange} />}
    </div>
  );
}

/* ─── Section group ─────────────────────────────────────────────────────────── */

function ModelGroup({
  title,
  accent,
  models,
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
}: {
  title: string;
  accent: string;
  models: { id: string; name: string; provider: string; category: string; hasAzureDeployment?: boolean }[];
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
}) {
  return (
    <div>
      {/* Group header */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
        <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
          {title}
        </span>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {models.map((m) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <ModelRow
              id={m.id}
              name={m.name}
              providerLabel={m.provider}
              category={m.category}
              value={providers[m.id] ?? "kie"}
              onChange={(v) => onProviderChange(m.id, v)}
              azureSupported={m.hasAzureDeployment}
            />
            {/* Deployment name — shown only for Azure-capable models when Azure is selected */}
            {m.hasAzureDeployment && (providers[m.id] ?? "kie") === "azure" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px 14px",
                  background: "rgba(96,165,250,0.04)",
                  border: "1px solid rgba(96,165,250,0.12)",
                  borderRadius: "10px",
                }}
              >
                <label
                  htmlFor={`azure-deploy-${m.id}`}
                  style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}
                >
                  Deployment Name
                </label>
                <input
                  id={`azure-deploy-${m.id}`}
                  type="text"
                  placeholder={`e.g. ${m.id}`}
                  value={azureDeployments[m.id] ?? ""}
                  onChange={(e) => onDeploymentChange(m.id, e.target.value)}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "7px",
                    padding: "7px 11px",
                    fontSize: "12px",
                    color: "rgba(255,255,255,0.8)",
                    outline: "none",
                    fontFamily: "inherit",
                    fontFeatureSettings: "\"tnum\"",
                  }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(96,165,250,0.4)"; }}
                  onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                />
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
                  The deployment name within your Azure resource. Combined with the global base URL above.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── API Keys panel ─────────────────────────────────────────────────────────── */

const INPUT_STYLE: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "7px",
  padding: "7px 11px",
  fontSize: "12px",
  color: "rgba(255,255,255,0.8)",
  outline: "none",
  fontFamily: "inherit",
  width: "100%",
};

function ApiKeysPanel({
  azureBaseUrl,
  onBaseUrlChange,
  kieKeyStatus,
  onKieKeySave,
  onKieKeyDelete,
  azureKeyStatus,
  onAzureKeySave,
  onAzureKeyDelete,
}: {
  azureBaseUrl: string;
  onBaseUrlChange: (v: string) => void;
  kieKeyStatus: "unknown" | "set" | "unset";
  onKieKeySave: (token: string) => Promise<void>;
  onKieKeyDelete: () => Promise<void>;
  azureKeyStatus: "unknown" | "set" | "unset";
  onAzureKeySave: (key: string) => Promise<void>;
  onAzureKeyDelete: () => Promise<void>;
}) {
  const [kieInput, setKieInput]       = useState("");
  const [kieSaving, setKieSaving]     = useState(false);
  const [kieError, setKieError]       = useState<string | null>(null);
  const [azureInput, setAzureInput]   = useState("");
  const [azureSaving, setAzureSaving] = useState(false);
  const [azureError, setAzureError]   = useState<string | null>(null);

  const handleKieSave = async () => {
    if (!kieInput.trim()) return;
    setKieSaving(true);
    setKieError(null);
    try {
      await onKieKeySave(kieInput.trim());
      setKieInput("");
    } catch (e: unknown) {
      setKieError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setKieSaving(false);
    }
  };

  const handleAzureSave = async () => {
    if (!azureInput.trim()) return;
    setAzureSaving(true);
    setAzureError(null);
    try {
      await onAzureKeySave(azureInput.trim());
      setAzureInput("");
    } catch (e: unknown) {
      setAzureError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setAzureSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.2 }}>
          API Keys
        </h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "6px", lineHeight: 1.5 }}>
          Your Kie.ai key is stored securely on the server — it is never exposed to the browser.
        </p>
      </div>

      {/* ──── Kie.ai API key ──────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "7px",
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.55)",
            }}
          >
            K
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Kie.ai</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Used for all image &amp; video generation
            </div>
          </div>
          {kieKeyStatus === "set" && (
            <span
              style={{
                marginLeft: "auto", fontSize: "10px", fontWeight: 600,
                color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
                padding: "2px 7px", letterSpacing: "0.04em",
              }}
            >
              SAVED
            </span>
          )}
        </div>

        {kieKeyStatus === "unknown" ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{
              flex: 1, height: "31px", borderRadius: "7px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite",
            }} />
            <div style={{
              width: "72px", height: "31px", borderRadius: "7px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite 0.2s",
            }} />
          </div>
        ) : kieKeyStatus === "set" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input
              type="password"
              value="placeholdertoken"
              readOnly
              style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
            />
            <button
              onClick={onKieKeyDelete}
              style={{
                padding: "7px 12px", borderRadius: "7px", border: "1px solid rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
                cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="password"
                placeholder="Paste your Kie.ai API token"
                value={kieInput}
                onChange={(e) => setKieInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleKieSave(); }}
                style={{ ...INPUT_STYLE, flex: 1 }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.2)"; }}
                onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
              />
              <button
                onClick={handleKieSave}
                disabled={!kieInput.trim() || kieSaving}
                style={{
                  padding: "7px 14px", borderRadius: "7px", border: "none",
                  background: kieInput.trim() ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                  color: kieInput.trim() ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
                  cursor: kieInput.trim() ? "pointer" : "default",
                  fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                  transition: "background 140ms ease, color 140ms ease",
                }}
              >
                {kieSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {kieError && (
              <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{kieError}</p>
            )}
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Get your token at{" "}
              <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>
                kie.ai/api-key
              </a>
            </p>
          </div>
        )}
      </div>

      {/* ──── Azure Foundry API key + endpoint ────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "16px",
          background: "rgba(96,165,250,0.04)",
          border: "1px solid rgba(96,165,250,0.14)",
          borderRadius: "12px",
        }}
      >
        {/* Azure logo/title row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "7px",
              background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, color: "rgba(96,165,250,0.85)",
            }}
          >
            Az
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Azure Foundry</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              API key &amp; base URL — used by all Azure-routed models
            </div>
          </div>
          {azureKeyStatus === "set" && (
            <span
              style={{
                marginLeft: "auto", fontSize: "10px", fontWeight: 600,
                color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
                border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px",
                padding: "2px 7px", letterSpacing: "0.04em",
              }}
            >
              SAVED
            </span>
          )}
        </div>

        {/* API Key */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label
            htmlFor="azure-api-key"
            style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            API Key
          </label>
          {azureKeyStatus === "unknown" ? (
            <div style={{
              height: "31px", borderRadius: "7px",
              background: "rgba(255,255,255,0.05)",
              animation: "skeleton-pulse 1.4s ease-in-out infinite",
            }} />
          ) : azureKeyStatus === "set" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="password"
                value="placeholdertoken"
                readOnly
                style={{ ...INPUT_STYLE, flex: 1, cursor: "default", color: "rgba(255,255,255,0.3)" }}
              />
              <button
                onClick={onAzureKeyDelete}
                style={{
                  padding: "7px 12px", borderRadius: "7px", border: "1px solid rgba(239,68,68,0.3)",
                  background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
                  cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                }}
              >
                Remove
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  id="azure-api-key"
                  type="password"
                  placeholder="Paste your Azure Foundry API key"
                  value={azureInput}
                  onChange={(e) => setAzureInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAzureSave(); }}
                  style={{ ...INPUT_STYLE, flex: 1 }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(96,165,250,0.4)"; }}
                  onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
                />
                <button
                  onClick={handleAzureSave}
                  disabled={!azureInput.trim() || azureSaving}
                  style={{
                    padding: "7px 14px", borderRadius: "7px", border: "none",
                    background: azureInput.trim() ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.04)",
                    color: azureInput.trim() ? "rgba(96,165,250,0.9)" : "rgba(255,255,255,0.25)",
                    cursor: azureInput.trim() ? "pointer" : "default",
                    fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
                    transition: "background 140ms ease, color 140ms ease",
                  }}
                >
                  {azureSaving ? "Saving…" : "Save"}
                </button>
              </div>
              {azureError && (
                <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{azureError}</p>
              )}
            </div>
          )}
        </div>

        {/* Base URL */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label
            htmlFor="azure-global-base-url"
            style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            Base URL
          </label>
          <input
            id="azure-global-base-url"
            type="url"
            placeholder="https://<resource>.cognitiveservices.azure.com"
            value={azureBaseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            style={INPUT_STYLE}
            onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(96,165,250,0.4)"; }}
            onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
          />
          <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
            Combined with per-model deployment names below.
          </p>
        </div>
      </div>

    </div>
  );
}

/* ─── Provider legend (shared) ───────────────────────────────────────────────── */

function ProviderLegend() {
  return (
    <div style={{ display: "flex", gap: "12px", padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px" }}>
      {PROVIDERS.map((p) => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ width: "24px", height: "24px", borderRadius: "6px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.02em" }}>
            {p.id === "kie" ? "K" : "A"}
          </span>
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{p.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Image Models panel ─────────────────────────────────────────────────────── */

function ImageModelsPanel({
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
}: {
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
}) {
  const models = IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Image",
    hasAzureDeployment: !!m.azureSizeMap,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.2 }}>
          Image Models
        </h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "6px", lineHeight: 1.5 }}>
          Choose which provider serves each image model. Azure-capable models show a deployment name field when Azure is selected.
        </p>
      </div>
      <ProviderLegend />
      <ModelGroup
        title="Image Models"
        accent="#fb923c"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </div>
  );
}

/* ─── Video Models panel ─────────────────────────────────────────────────────── */

function VideoModelsPanel({
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
}: {
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
}) {
  const models = VIDEO_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Video",
    hasAzureDeployment: false,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.2 }}>
          Video Models
        </h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "6px", lineHeight: 1.5 }}>
          Choose which provider serves each video model.
        </p>
      </div>
      <ProviderLegend />
      <ModelGroup
        title="Video Models"
        accent="#5EEAD4"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </div>
  );
}

/* ─── Text Models panel ──────────────────────────────────────────────────────── */

function TextModelsPanel({
  azureKeyStatus,
  azureBaseUrl,
  azureTextDeployment,
  azureTextModelName,
  onDeploymentChange,
  onModelNameChange,
}: {
  azureKeyStatus: "unknown" | "set" | "unset";
  azureBaseUrl: string;
  azureTextDeployment: string;
  azureTextModelName: string;
  onDeploymentChange: (v: string) => void;
  onModelNameChange: (v: string) => void;
}) {
  const azureReady = azureKeyStatus === "set" && !!azureBaseUrl.trim();
  const kieGroups = MODEL_GROUPS.filter(g => g.label !== "Azure");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.2 }}>
          Text Models
        </h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "6px", lineHeight: 1.5 }}>
          Configure AI text models for chat. Azure Auto uses your Azure Foundry credentials from the API Keys tab.
        </p>
      </div>

      {/* Kie.ai models */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {kieGroups.map((group) => (
          <div key={group.label}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "#e5e5e5", flexShrink: 0 }} />
              <span style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)", textTransform: "uppercase" }}>
                {group.label}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {group.models.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex", alignItems: "center", gap: "14px",
                    padding: "11px 16px", borderRadius: "10px",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.85)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.28)", marginTop: "2px" }}>
                      Kie.ai · {m.desc}
                    </div>
                  </div>
                  <span style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "3px 8px", borderRadius: "6px",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)",
                    fontSize: "11px", fontWeight: 500, color: "rgba(255,255,255,0.4)",
                    whiteSpace: "nowrap",
                  }}>
                    <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.55)" }}>K</span>
                    Kie.ai
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Azure Auto card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          padding: "16px",
          background: "rgba(96,165,250,0.04)",
          border: "1px solid rgba(96,165,250,0.14)",
          borderRadius: "12px",
        }}
      >
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              width: "28px", height: "28px", borderRadius: "7px",
              background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "11px", fontWeight: 700, color: "rgba(96,165,250,0.85)",
            }}
          >
            Az
          </span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Azure Auto</div>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
              Model-router — automatically selects the best model for each request
            </div>
          </div>
          <span
            style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 600,
              color: azureReady ? "rgba(74,222,128,0.8)" : "rgba(251,146,60,0.8)",
              background: azureReady ? "rgba(74,222,128,0.08)" : "rgba(251,146,60,0.08)",
              border: `1px solid ${azureReady ? "rgba(74,222,128,0.2)" : "rgba(251,146,60,0.2)"}`,
              borderRadius: "5px", padding: "2px 7px", letterSpacing: "0.04em", whiteSpace: "nowrap",
            }}
          >
            {azureReady ? "READY" : "NOT CONFIGURED"}
          </span>
        </div>

        {/* Status notice if not ready */}
        {!azureReady && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(251,146,60,0.05)",
              border: "1px solid rgba(251,146,60,0.15)",
              borderRadius: "8px",
              fontSize: "11px",
              color: "rgba(251,146,60,0.7)",
              lineHeight: 1.5,
            }}
          >
            {azureKeyStatus !== "set"
              ? "Add your Azure Foundry API key in the API Keys tab to enable this model."
              : "Add your Azure Foundry Base URL in the API Keys tab to enable this model."}
          </div>
        )}

        {/* Two-column grid: Model Name + Deployment */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Model Name */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label
              htmlFor="azure-text-model-name"
              style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}
            >
              Model Name
            </label>
            <input
              id="azure-text-model-name"
              type="text"
              placeholder="model-router"
              value={azureTextModelName}
              onChange={(e) => onModelNameChange(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "7px",
                padding: "7px 11px",
                fontSize: "12px",
                color: "rgba(255,255,255,0.8)",
                outline: "none",
                fontFamily: "inherit",
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(96,165,250,0.4)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Passed as <code style={{ fontFamily: "monospace" }}>model</code> in the request body.
            </p>
          </div>

          {/* Deployment */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label
              htmlFor="azure-text-deployment"
              style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}
            >
              Deployment
            </label>
            <input
              id="azure-text-deployment"
              type="text"
              placeholder="auto-model"
              value={azureTextDeployment}
              onChange={(e) => onDeploymentChange(e.target.value)}
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "7px",
                padding: "7px 11px",
                fontSize: "12px",
                color: "rgba(255,255,255,0.8)",
                outline: "none",
                fontFamily: "inherit",
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(96,165,250,0.4)"; }}
              onBlur={(e)  => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
              Used in the URL path <code style={{ fontFamily: "monospace" }}>/deployments/{"{deployment}"}</code>.
            </p>
          </div>
        </div>

        {/* API version (read-only) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <span style={{ fontSize: "11px", fontWeight: 600, color: "rgba(96,165,250,0.7)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            API Version
          </span>
          <div style={{ padding: "7px 11px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "7px", fontSize: "12px", color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
            2024-04-01-preview
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Debug panel ───────────────────────────────────────────────────────────── */

function DebugPanel() {
  const debugMode     = useWorkflowStore((s) => s.debugMode);
  const toggleDebug   = useWorkflowStore((s) => s.toggleDebug);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, marginBottom: "4px" }}>Debug</h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
          Only visible when <code style={{ fontFamily: "monospace", color: "rgba(251,146,60,0.8)" }}>NEXT_PUBLIC_DEBUG=true</code>
        </p>
      </div>

      {/* Simulate generation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>Simulate generation</span>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>
            Skip the real API call — fake a 5-second generation and log the payload to the server console.
          </span>
        </div>
        <button
          onClick={toggleDebug}
          style={{
            flexShrink: 0,
            width: "40px",
            height: "22px",
            borderRadius: "11px",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            background: debugMode ? "rgba(251,146,60,0.8)" : "rgba(255,255,255,0.12)",
            transition: "background 200ms",
            display: "flex",
            alignItems: "center",
          }}
        >
          <div style={{
            width: "18px",
            height: "18px",
            borderRadius: "50%",
            background: "#fff",
            transform: debugMode ? "translateX(18px)" : "translateX(0px)",
            transition: "transform 200ms cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
          }} />
        </button>
      </div>
    </div>
  );
}

/* ─── Main modal ─────────────────────────────────────────────────────────────── */

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeNav, setActiveNav]             = useState<NavId>("api-keys");
  const [modelProviders, setModelProviders]   = useState<Record<string, ProviderId>>({});
  const [azureDeployments, setAzureDeployments] = useState<Record<string, string>>({});
  const [azureBaseUrl, setAzureBaseUrl]               = useState("");
  const [azureTextDeployment, setAzureTextDeployment] = useState("auto-model");
  const [azureTextModelName, setAzureTextModelName]   = useState("model-router");
  const [kieKeyStatus, setKieKeyStatus]               = useState<"unknown" | "set" | "unset">("unknown");
  const [azureKeyStatus, setAzureKeyStatus]   = useState<"unknown" | "set" | "unset">("unknown");
  const setKieKeySet    = useWorkflowStore((s) => s.setKieKeySet);
  const setAzureKeySet  = useWorkflowStore((s) => s.setAzureKeySet);
  const overlayRef = useRef<HTMLDivElement>(null);

  async function authHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await createClient().auth.getSession();
    const h: Record<string, string> = {};
    if (session?.access_token) h["Authorization"] = `Bearer ${session.access_token}`;
    return h;
  }

  /* Load persisted data on mount */
  useEffect(() => {
    setModelProviders(loadModelProviders());
    setAzureDeployments(loadAzureEndpoints());
    setAzureBaseUrl(loadAzureBaseUrl());
    setAzureTextDeployment(loadAzureTextDeployment());
    setAzureTextModelName(loadAzureTextModelName());
    // Check if Kie key is saved on the server
    authHeader().then((h) =>
      fetch("/api/settings/kie-key", { headers: h })
        .then((r) => r.json())
        .then((d) => setKieKeyStatus(d.hasToken ? "set" : "unset"))
        .catch(() => setKieKeyStatus("unset"))
    );
    // Check if Azure key is saved on the server
    authHeader().then((h) =>
      fetch("/api/settings/azure-key", { headers: h })
        .then((r) => r.json())
        .then((d) => setAzureKeyStatus(d.hasToken ? "set" : "unset"))
        .catch(() => setAzureKeyStatus("unset"))
    );
  }, []);

  /* Close on Escape */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /* Close on backdrop click */
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleProviderChange = (modelId: string, v: ProviderId) => {
    const next = { ...modelProviders, [modelId]: v };
    saveModelProviders(next);
    setModelProviders(next);
  };

  const handleDeploymentChange = (modelId: string, v: string) => {
    setAzureDeployments((prev) => {
      const next = { ...prev, [modelId]: v };
      saveAzureEndpoints(next);
      return next;
    });
  };

  const handleBaseUrlChange = (v: string) => {
    setAzureBaseUrl(v);
    saveAzureBaseUrl(v);
  };

  const handleKieKeySave = async (token: string) => {
    const h = await authHeader();
    const res = await fetch("/api/settings/kie-key", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ kieApiToken: token }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setKieKeyStatus("set");
    setKieKeySet(true);
  };

  const handleKieKeyDelete = async () => {
    const h = await authHeader();
    await fetch("/api/settings/kie-key", { method: "DELETE", headers: h });
    setKieKeyStatus("unset");
    setKieKeySet(false);
  };

  const handleAzureKeySave = async (key: string) => {
    const h = await authHeader();
    const res = await fetch("/api/settings/azure-key", {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ azureApiKey: key }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save");
    setAzureKeyStatus("set");
    setAzureKeySet(true);
  };

  const handleAzureKeyDelete = async () => {
    const h = await authHeader();
    await fetch("/api/settings/azure-key", { method: "DELETE", headers: h });
    setAzureKeyStatus("unset");
    setAzureKeySet(false);
  };

  const handleAzureTextDeploymentChange = (v: string) => {
    setAzureTextDeployment(v);
    saveAzureTextDeployment(v);
  };

  const handleAzureTextModelNameChange = (v: string) => {
    setAzureTextModelName(v);
    saveAzureTextModelName(v);
  };

  return (
    <>
      {/* ── Keyframe animations ── */}
      <style>{`
        @keyframes settingsOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes settingsModalIn {
          from { opacity: 0; transform: translate(-50%, -48%) scale(0.96); }
          to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      {/* ── Backdrop ── */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          animation: "settingsOverlayIn 180ms ease both",
        }}
      />

      {/* ── Modal shell ── */}
      <div
        id="settings-modal"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          width: "min(75vw, 960px)",
          height: "min(75vh, 680px)",
          display: "flex",
          borderRadius: "18px",
          background: "rgba(10, 11, 14, 0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.5)",
          overflow: "hidden",
          animation: "settingsModalIn 220ms cubic-bezier(0.22,1,0.36,1) both",
        }}
      >
        {/* ── Left sidebar ── */}
        <div
          style={{
            width: "200px",
            flexShrink: 0,
            borderRight: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            flexDirection: "column",
            padding: "20px 12px",
            gap: "2px",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              color: "rgba(255,255,255,0.6)",
              padding: "4px 10px 14px",
              letterSpacing: "0.01em",
            }}
          >
            Settings
          </div>

          {/* Nav items */}
          {NAV.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                onClick={() => setActiveNav(item.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: "pointer",
                  background: isActive ? "rgba(255,255,255,0.07)" : "transparent",
                  color: isActive ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                  fontSize: "13px",
                  fontWeight: isActive ? 500 : 400,
                  textAlign: "left",
                  transition: "background 130ms ease, color 130ms ease",
                  width: "100%",
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                    (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
                  }
                }}
              >
                <span style={{ opacity: isActive ? 1 : 0.6, flexShrink: 0 }}>{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>

        {/* ── Right content ── */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          {/* Top bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "16px 20px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              flexShrink: 0,
            }}
          >
            <button
              id="settings-close"
              onClick={onClose}
              title="Close (Esc)"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "28px",
                height: "28px",
                borderRadius: "7px",
                border: "none",
                cursor: "pointer",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.4)",
                transition: "background 130ms ease, color 130ms ease",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.8)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)";
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "28px 28px 40px",
            }}
          >
            {activeNav === "api-keys" && (
              <ApiKeysPanel
                azureBaseUrl={azureBaseUrl}
                onBaseUrlChange={handleBaseUrlChange}
                kieKeyStatus={kieKeyStatus}
                onKieKeySave={handleKieKeySave}
                onKieKeyDelete={handleKieKeyDelete}
                azureKeyStatus={azureKeyStatus}
                onAzureKeySave={handleAzureKeySave}
                onAzureKeyDelete={handleAzureKeyDelete}
              />
            )}
            {activeNav === "image-models" && (
              <ImageModelsPanel
                providers={modelProviders}
                onProviderChange={handleProviderChange}
                azureDeployments={azureDeployments}
                onDeploymentChange={handleDeploymentChange}
              />
            )}
            {activeNav === "video-models" && (
              <VideoModelsPanel
                providers={modelProviders}
                onProviderChange={handleProviderChange}
                azureDeployments={azureDeployments}
                onDeploymentChange={handleDeploymentChange}
              />
            )}
            {activeNav === "text-models" && (
              <TextModelsPanel
                azureKeyStatus={azureKeyStatus}
                azureBaseUrl={azureBaseUrl}
                azureTextDeployment={azureTextDeployment}
                azureTextModelName={azureTextModelName}
                onDeploymentChange={handleAzureTextDeploymentChange}
                onModelNameChange={handleAzureTextModelNameChange}
              />
            )}
            {activeNav === "debug" && IS_DEBUG && <DebugPanel />}
          </div>
        </div>
      </div>
    </>
  );
}
