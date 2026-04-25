"use client";
import React, { useEffect, useRef, useState } from "react";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";

/* ─── Provider options ──────────────────────────────────────────────────────── */

export const PROVIDERS = [
  { id: "kie",   label: "Kie.ai" },
  { id: "azure", label: "Azure Foundry" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

/* ─── Persistence ───────────────────────────────────────────────────────────── */

const STORAGE_KEY       = "aiui-model-providers";
const AZURE_DEPLOYS_KEY = "aiui-azure-endpoints";   // per-model deployment names
const AZURE_BASE_KEY    = "aiui-azure-base-url";     // global Foundry base URL

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

/* ─── Nav items ─────────────────────────────────────────────────────────────── */

type NavId = "api-keys";

const NAV: { id: NavId; label: string; icon: React.ReactNode }[] = [
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
];

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
}: {
  id: string;
  name: string;
  providerLabel: string;
  category: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
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

      {/* Provider toggle */}
      <ProviderToggle modelId={id} value={value} onChange={onChange} />
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
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
  azureBaseUrl,
  onBaseUrlChange,
}: {
  providers: Record<string, ProviderId>;
  onProviderChange: (modelId: string, v: ProviderId) => void;
  azureDeployments: Record<string, string>;
  onDeploymentChange: (modelId: string, v: string) => void;
  azureBaseUrl: string;
  onBaseUrlChange: (v: string) => void;
}) {
  const imageModels = IMAGE_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Image",
    hasAzureDeployment: !!m.azureSizeMap,
  }));

  const videoModels = VIDEO_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    provider: m.provider,
    category: "Video",
    hasAzureDeployment: false,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 600, color: "rgba(255,255,255,0.9)", margin: 0, lineHeight: 1.2 }}>
          API Keys
        </h2>
        <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.28)", marginTop: "6px", lineHeight: 1.5 }}>
          Choose which provider handles each model. Set the global Azure base URL once and specify
          a deployment name per model.
        </p>
      </div>

      {/* ──── Global Azure Foundry endpoint ───────────────────────────── */}
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
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>Global base URL — used by all Azure-routed models</div>
          </div>
        </div>

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
            The <code style={{ fontFamily: "monospace" }}>AZURE_API_KEY</code> environment variable must be set on the server.
          </p>
        </div>
      </div>

      {/* Provider legend */}
      <div style={{ display: "flex", gap: "12px", padding: "12px 16px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px" }}>
        {PROVIDERS.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "24px", height: "24px", borderRadius: "6px",
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "10px", fontWeight: 700, color: "rgba(255,255,255,0.55)", letterSpacing: "0.02em",
              }}
            >
              {p.id === "kie" ? "K" : "A"}
            </span>
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{p.label}</span>
          </div>
        ))}
      </div>

      {/* Image models */}
      <ModelGroup
        title="Image Models"
        accent="#fb923c"
        models={imageModels}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />

      {/* Video models */}
      <ModelGroup
        title="Video Models"
        accent="#a78bfa"
        models={videoModels}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </div>
  );
}

/* ─── Main modal ─────────────────────────────────────────────────────────────── */

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeNav, setActiveNav]         = useState<NavId>("api-keys");
  const [modelProviders, setModelProviders] = useState<Record<string, ProviderId>>({});
  const [azureDeployments, setAzureDeployments] = useState<Record<string, string>>({});
  const [azureBaseUrl, setAzureBaseUrl]   = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  /* Load persisted data on mount */
  useEffect(() => {
    setModelProviders(loadModelProviders());
    setAzureDeployments(loadAzureEndpoints());
    setAzureBaseUrl(loadAzureBaseUrl());
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
                providers={modelProviders}
                onProviderChange={handleProviderChange}
                azureDeployments={azureDeployments}
                onDeploymentChange={handleDeploymentChange}
                azureBaseUrl={azureBaseUrl}
                onBaseUrlChange={handleBaseUrlChange}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
