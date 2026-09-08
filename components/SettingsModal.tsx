"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";
import { MODEL_GROUPS } from "@/lib/models";
import { useWorkflowStore } from "@/lib/store";
import { PROVIDERS, ProviderId, loadModelProviders, saveModelProviders, getModelProvider } from "@/lib/providers";

/* ─── Provider options (re-exported for backwards compat) ───────────────────── */

export { PROVIDERS, loadModelProviders, saveModelProviders, getModelProvider };
export type { ProviderId };

export type CodexStatus =
  | { kind: "unknown" }
  | { kind: "ready" }
  | { kind: "not_ready"; installed: boolean; authFound: boolean };

/* ─── Persistence ───────────────────────────────────────────────────────────── */

const AZURE_DEPLOYS_KEY      = "aiui-azure-endpoints";       // per-model deployment names
const AZURE_BASE_KEY         = "aiui-azure-base-url";        // global Foundry base URL
const AZURE_TEXT_DEPLOY_KEY  = "aiui-azure-text-deployment"; // text model deployment (URL path)
const AZURE_TEXT_MODEL_KEY   = "aiui-azure-text-model";      // text model name (request body)

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

/* ─── Tabs ──────────────────────────────────────────────────────────────────── */

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === "true";

type NavId = "api-keys" | "image-models" | "video-models" | "text-models" | "debug";

const NAV_BASE: { id: NavId; label: string }[] = [
  { id: "api-keys", label: "API Keys" },
  { id: "image-models", label: "Image Models" },
  { id: "video-models", label: "Video Models" },
  { id: "text-models", label: "Text Models" },
];

const DEBUG_NAV_ITEM: { id: NavId; label: string } = { id: "debug", label: "Debug" };

const NAV = IS_DEBUG ? [...NAV_BASE, DEBUG_NAV_ITEM] : NAV_BASE;

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface SettingsModalProps {
  onClose: () => void;
}

/* ─── Shared style helpers ────────────────────────────────────────────────── */

/** Pill input, h-10, per components.md > Input. `mono` for key/URL values. */
function inputStyle(mono: boolean): React.CSSProperties {
  return {
    height: "40px",
    width: "100%",
    padding: "0 14px",
    background: "var(--bg-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--r-pill)",
    color: "var(--text-1)",
    fontSize: mono ? "13px" : "14px",
    fontFamily: mono ? "var(--font-mono)" : "inherit",
    outline: "none",
  };
}

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "var(--accent)";
  e.target.style.outline = "2px solid var(--focus-ring)";
  e.target.style.outlineOffset = "2px";
}
function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.target.style.borderColor = "var(--border-2)";
  e.target.style.outline = "none";
}

/** Primary sm pill — Save / Connect actions. */
function PrimaryButtonSm({ children, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        height: "32px",
        padding: "0 14px",
        borderRadius: "var(--r-pill)",
        border: "none",
        background: "var(--accent)",
        color: "var(--on-accent)",
        fontSize: "13px",
        fontWeight: 600,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        whiteSpace: "nowrap",
        boxShadow: "0 2px 0 var(--accent-edge)",
        opacity: disabled ? 0.4 : 1,
        transition: "transform 120ms, box-shadow 120ms",
      }}
    >
      {children}
    </button>
  );
}

/** Secondary sm pill. */
function SecondaryButtonSm({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        height: "32px",
        padding: "0 14px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--border-2)",
        background: "var(--surface)",
        color: "var(--text-1)",
        fontSize: "13px",
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-2)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)"; }}
    >
      {children}
    </button>
  );
}

/** Danger sm pill — Remove key. */
function DangerButtonSm({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      style={{
        height: "32px",
        padding: "0 14px",
        borderRadius: "var(--r-pill)",
        border: "1px solid var(--error)",
        background: "transparent",
        color: "var(--error)",
        fontSize: "13px",
        fontWeight: 500,
        fontFamily: "inherit",
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "background 120ms, color 120ms",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--error)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--on-accent)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--error)"; }}
    >
      {children}
    </button>
  );
}

/** Badge per components.md > Badge. `filled` = SAVED/READY, otherwise outlined NOT CONFIGURED. */
function StatusBadge({ filled, children }: { filled: boolean; children: React.ReactNode }) {
  return (
    <span
      className="label"
      style={{
        padding: "4px 10px",
        borderRadius: "var(--r-pill)",
        fontWeight: filled ? 700 : 500,
        background: filled ? "var(--accent)" : "transparent",
        color: filled ? "var(--on-accent)" : "var(--text-2)",
        border: filled ? "none" : "1px solid var(--border-2)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/** Section card — bg-2, 1px border-1, radius 16, padding 16, per components.md > Modal. */
function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        padding: "16px",
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: "16px",
      }}
    >
      {children}
    </div>
  );
}

/* ─── Segmented control — per-model provider selection ───────────────────────── */

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
        display: "inline-flex",
        alignItems: "center",
        background: "var(--bg-2)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-pill)",
        padding: "3px",
        gap: "2px",
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
              padding: "6px 12px",
              borderRadius: "var(--r-pill)",
              border: "none",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              fontFamily: "inherit",
              transition: "background 120ms, color 120ms",
              background: active ? "var(--text-1)" : "transparent",
              color: active ? "var(--on-accent)" : "var(--text-2)",
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
  isLast,
}: {
  id: string;
  name: string;
  providerLabel: string;
  category: string;
  value: ProviderId;
  onChange: (v: ProviderId) => void;
  azureSupported: boolean;
  isLast: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "12px 0",
        borderBottom: isLast ? "none" : "1px solid var(--border-1)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--text-1)",
            lineHeight: 1.3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
          {providerLabel} · {category}
        </div>
      </div>

      {/* Provider toggle — only shown for models with more than one backend to choose from */}
      {azureSupported && <ProviderToggle modelId={id} value={value} onChange={onChange} />}
    </div>
  );
}

/* ─── Section group ─────────────────────────────────────────────────────────── */

function ModelGroup({
  title,
  models,
  providers,
  onProviderChange,
  azureDeployments,
  onDeploymentChange,
}: {
  title: string;
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
        <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
        <span className="label" style={{ color: "var(--text-3)" }}>{title}</span>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {models.map((m, i) => (
          <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <ModelRow
              id={m.id}
              name={m.name}
              providerLabel={m.provider}
              category={m.category}
              value={providers[m.id] ?? "kie"}
              onChange={(v) => onProviderChange(m.id, v)}
              azureSupported={!!m.hasAzureDeployment}
              isLast={i === models.length - 1 && (providers[m.id] ?? "kie") !== "azure"}
            />
            {/* Deployment name — shown only for Azure-capable models when Azure is selected */}
            {m.hasAzureDeployment && (providers[m.id] ?? "kie") === "azure" && (
              <div style={{ paddingBottom: "12px", borderBottom: i === models.length - 1 ? "none" : "1px solid var(--border-1)" }}>
                <SectionCard>
                  <label htmlFor={`azure-deploy-${m.id}`} className="label" style={{ color: "var(--text-3)" }}>
                    Deployment Name
                  </label>
                  <input
                    id={`azure-deploy-${m.id}`}
                    type="text"
                    placeholder={`e.g. ${m.id}`}
                    value={azureDeployments[m.id] ?? ""}
                    onChange={(e) => onDeploymentChange(m.id, e.target.value)}
                    style={inputStyle(true)}
                    onFocus={focusInput}
                    onBlur={blurInput}
                  />
                  <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
                    The deployment name within your Azure resource. Combined with the global base URL above.
                  </p>
                </SectionCard>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── API Keys panel ─────────────────────────────────────────────────────────── */

function ApiKeysPanel({
  azureBaseUrl,
  onBaseUrlChange,
  kieKeyStatus,
  onKieKeySave,
  onKieKeyDelete,
  azureKeyStatus,
  onAzureKeySave,
  onAzureKeyDelete,
  codexStatus,
  onCodexLoginSuccess,
}: {
  azureBaseUrl: string;
  onBaseUrlChange: (v: string) => void;
  kieKeyStatus: "unknown" | "set" | "unset";
  onKieKeySave: (token: string) => Promise<void>;
  onKieKeyDelete: () => Promise<void>;
  azureKeyStatus: "unknown" | "set" | "unset";
  onAzureKeySave: (key: string) => Promise<void>;
  onAzureKeyDelete: () => Promise<void>;
  codexStatus: CodexStatus;
  onCodexLoginSuccess: () => void;
}) {
  const [kieInput, setKieInput]       = useState("");
  const [kieSaving, setKieSaving]     = useState(false);
  const [kieError, setKieError]       = useState<string | null>(null);
  const [azureInput, setAzureInput]   = useState("");
  const [azureSaving, setAzureSaving] = useState(false);
  const [azureError, setAzureError]   = useState<string | null>(null);

  type CodexLoginFlow =
    | { status: "idle" }
    | { status: "starting" }
    | { status: "pending"; url: string; code: string }
    | { status: "error"; error: string };
  const [loginFlow, setLoginFlow] = useState<CodexLoginFlow>({ status: "idle" });
  const [codeCopied, setCodeCopied] = useState(false);

  const handleConnectCodex = async () => {
    setLoginFlow({ status: "starting" });
    try {
      const res = await fetch("/api/settings/codex-login", { method: "POST" });
      const d = await res.json();
      if (d.status === "pending") setLoginFlow({ status: "pending", url: d.url, code: d.code });
      else setLoginFlow({ status: "error", error: d.error ?? "Failed to start login" });
    } catch (e: unknown) {
      setLoginFlow({ status: "error", error: e instanceof Error ? e.message : "Failed to start login" });
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    }).catch(() => {});
  };

  /* Poll while a device-code login is pending, until it resolves */
  useEffect(() => {
    if (loginFlow.status !== "pending") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/settings/codex-login");
        const d = await res.json();
        if (d.status === "success") {
          setLoginFlow({ status: "idle" });
          onCodexLoginSuccess();
        } else if (d.status === "error") {
          // Safety net: the login-store verdict can race the credential write.
          // Before showing a red error, confirm against codex-status (which
          // just checks auth.json on disk) — if the login actually landed,
          // treat it as success instead of latching an error.
          let recovered = false;
          try {
            const s = await fetch("/api/settings/codex-status").then((r) => r.json());
            if (s.ready || s.authFound) recovered = true;
          } catch { /* fall through to error */ }
          if (recovered) {
            setLoginFlow({ status: "idle" });
            onCodexLoginSuccess();
          } else {
            setLoginFlow({ status: "error", error: d.error ?? "Login failed" });
          }
        }
        // "pending" → keep polling
      } catch { /* network hiccup — keep polling */ }
    }, 2500);
    return () => clearInterval(interval);
  }, [loginFlow.status, onCodexLoginSuccess]);

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

  const codexBadgeFilled = codexStatus.kind === "ready";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* ──── Kie.ai API key ──────────────────────────────────────────── */}
      <SectionCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)" }}>Kie.ai</div>
            <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
              Used for all image &amp; video generation
            </div>
          </div>
          {kieKeyStatus !== "unknown" && (
            <StatusBadge filled={kieKeyStatus === "set"}>
              {kieKeyStatus === "set" ? "SAVED" : "NOT CONFIGURED"}
            </StatusBadge>
          )}
        </div>

        {kieKeyStatus === "unknown" ? (
          <div style={{ display: "flex", gap: "8px" }}>
            <div style={{ flex: 1, height: "40px", borderRadius: "var(--r-pill)", background: "var(--border-1)", animation: "skeleton-pulse 1.4s ease-in-out infinite" }} />
            <div style={{ width: "80px", height: "40px", borderRadius: "var(--r-pill)", background: "var(--border-1)", animation: "skeleton-pulse 1.4s ease-in-out infinite 0.2s" }} />
          </div>
        ) : kieKeyStatus === "set" ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <input type="password" value="placeholdertoken" readOnly style={{ ...inputStyle(true), flex: 1, cursor: "default", color: "var(--text-3)" }} />
            <DangerButtonSm onClick={onKieKeyDelete}>Remove</DangerButtonSm>
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
                style={{ ...inputStyle(true), flex: 1 }}
                onFocus={focusInput}
                onBlur={blurInput}
              />
              <PrimaryButtonSm onClick={handleKieSave} disabled={!kieInput.trim() || kieSaving}>
                {kieSaving ? "Saving…" : "Save"}
              </PrimaryButtonSm>
            </div>
            {kieError && <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{kieError}</p>}
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
              Get your token at{" "}
              <a href="https://kie.ai/api-key" target="_blank" rel="noreferrer" style={{ color: "var(--text-2)" }}>
                kie.ai/api-key
              </a>
            </p>
          </div>
        )}
      </SectionCard>

      {/* ──── Azure Foundry API key + endpoint ────────────────────────── */}
      <SectionCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)" }}>Azure Foundry</div>
            <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
              API key &amp; base URL — used by all Azure-routed models
            </div>
          </div>
          {azureKeyStatus !== "unknown" && (
            <StatusBadge filled={azureKeyStatus === "set"}>
              {azureKeyStatus === "set" ? "SAVED" : "NOT CONFIGURED"}
            </StatusBadge>
          )}
        </div>

        {/* API Key */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label htmlFor="azure-api-key" className="label" style={{ color: "var(--text-3)" }}>
            API Key
          </label>
          {azureKeyStatus === "unknown" ? (
            <div style={{ height: "40px", borderRadius: "var(--r-pill)", background: "var(--border-1)", animation: "skeleton-pulse 1.4s ease-in-out infinite" }} />
          ) : azureKeyStatus === "set" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input type="password" value="placeholdertoken" readOnly style={{ ...inputStyle(true), flex: 1, cursor: "default", color: "var(--text-3)" }} />
              <DangerButtonSm onClick={onAzureKeyDelete}>Remove</DangerButtonSm>
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
                  style={{ ...inputStyle(true), flex: 1 }}
                  onFocus={focusInput}
                  onBlur={blurInput}
                />
                <PrimaryButtonSm onClick={handleAzureSave} disabled={!azureInput.trim() || azureSaving}>
                  {azureSaving ? "Saving…" : "Save"}
                </PrimaryButtonSm>
              </div>
              {azureError && <p style={{ fontSize: "12px", color: "var(--error)", margin: 0 }}>{azureError}</p>}
            </div>
          )}
        </div>

        {/* Base URL */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <label htmlFor="azure-global-base-url" className="label" style={{ color: "var(--text-3)" }}>
            Base URL
          </label>
          <input
            id="azure-global-base-url"
            type="url"
            placeholder="https://<resource>.cognitiveservices.azure.com"
            value={azureBaseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            style={inputStyle(true)}
            onFocus={focusInput}
            onBlur={blurInput}
          />
          <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            Combined with per-model deployment names below.
          </p>
        </div>
      </SectionCard>

      {/* ──── Codex CLI status ─────────────────────────────────────────── */}
      <SectionCard>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)" }}>Codex CLI</div>
            <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
              Uses the server&apos;s local <code style={{ fontFamily: "var(--font-mono)" }}>codex login</code> session — no per-user key
            </div>
          </div>
          <StatusBadge filled={codexBadgeFilled}>
            {codexStatus.kind === "unknown" ? "CHECKING" : codexStatus.kind === "ready" ? "READY" : "NOT CONFIGURED"}
          </StatusBadge>
        </div>

        {/* auth.json can exist but hold a stale/invalidated refresh token (e.g. the
            "session has ended" 401) — the status check only sees that the file is
            there, so it still reports READY. Offer a manual reauth escape hatch. */}
        {codexStatus.kind === "ready" && loginFlow.status === "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5, flex: 1 }}>
              Getting a &quot;session has ended&quot; or 401 error? Reauth below.
            </p>
            <PrimaryButtonSm onClick={handleConnectCodex}>Reauth</PrimaryButtonSm>
          </div>
        )}

        {/* Starting a new login immediately invalidates any existing session on this
            host — the CLI clears old credentials the moment a login attempt begins,
            before the user does anything in the browser. Only offer it when auth is
            actually missing; a missing binary alone shouldn't risk a working login. */}
        {codexStatus.kind === "not_ready" && !codexStatus.authFound && loginFlow.status === "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5, flex: 1 }}>
              Requires <a href="https://github.com/jdmnk/codex-imagegen-cli" target="_blank" rel="noreferrer" style={{ color: "var(--text-2)" }}>codex-imagegen-cli</a> installed on this server. Sign in below.
            </p>
            <PrimaryButtonSm onClick={handleConnectCodex}>Connect Codex</PrimaryButtonSm>
          </div>
        )}

        {codexStatus.kind === "not_ready" && codexStatus.authFound && !codexStatus.installed && loginFlow.status === "idle" && (
          <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
            Signed in, but <a href="https://github.com/jdmnk/codex-imagegen-cli" target="_blank" rel="noreferrer" style={{ color: "var(--text-2)" }}>codex-imagegen-cli</a> isn&apos;t installed on this server yet — image generation will fail until it is.
          </p>
        )}

        {loginFlow.status === "starting" && (
          <p style={{ fontSize: "13px", color: "var(--text-2)", margin: 0 }}>Starting login…</p>
        )}

        {loginFlow.status === "pending" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "12px", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: "12px" }}>
            <p style={{ fontSize: "13px", color: "var(--text-2)", margin: 0, lineHeight: 1.6 }}>
              1. Open{" "}
              <a href={loginFlow.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                {loginFlow.url}
              </a>
              <br />
              2. Enter this one-time code:
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                className="tabular"
                style={{
                  fontFamily: "var(--font-mono)", fontSize: "15px", fontWeight: 700, letterSpacing: "var(--tracking-mono)",
                  color: "var(--on-accent)", background: "var(--accent)",
                  borderRadius: "var(--r-pill)", padding: "6px 12px",
                }}
              >
                {loginFlow.code}
              </span>
              <SecondaryButtonSm onClick={() => handleCopyCode(loginFlow.code)}>
                {codeCopied ? "Copied" : "Copy"}
              </SecondaryButtonSm>
            </div>
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0 }}>
              Waiting for confirmation… the code expires in 15 minutes.
            </p>
          </div>
        )}

        {loginFlow.status === "error" && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <p style={{ fontSize: "13px", color: "var(--error)", margin: 0, flex: 1 }}>{loginFlow.error}</p>
            <SecondaryButtonSm onClick={handleConnectCodex}>Try again</SecondaryButtonSm>
          </div>
        )}
      </SectionCard>
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
    <SectionCard>
      <p style={{ fontSize: "13px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
        Choose which provider serves each image model. Azure-capable models show a deployment name field when Azure is selected.
      </p>
      <ModelGroup
        title="Image Models"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </SectionCard>
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
    <SectionCard>
      <p style={{ fontSize: "13px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
        Choose which provider serves each video model.
      </p>
      <ModelGroup
        title="Video Models"
        models={models}
        providers={providers}
        onProviderChange={onProviderChange}
        azureDeployments={azureDeployments}
        onDeploymentChange={onDeploymentChange}
      />
    </SectionCard>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {/* Kie.ai models */}
      <SectionCard>
        <p style={{ fontSize: "13px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
          Configure AI text models for chat. Azure Auto uses your Azure Foundry credentials from the API Keys tab.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {kieGroups.map((group) => (
            <div key={group.label}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                <span className="label" style={{ color: "var(--text-3)" }}>{group.label}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {group.models.map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      display: "flex", alignItems: "center", gap: "14px",
                      padding: "12px 0",
                      borderBottom: i === group.models.length - 1 ? "none" : "1px solid var(--border-1)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-1)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
                        Kie.ai · {m.desc}
                      </div>
                    </div>
                    <span className="label" style={{ color: "var(--text-2)" }}>Kie.ai</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Azure Auto card */}
      <SectionCard>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)" }}>Azure Auto</div>
            <div style={{ fontSize: "13px", color: "var(--text-3)", marginTop: "2px" }}>
              Model-router — automatically selects the best model for each request
            </div>
          </div>
          <StatusBadge filled={azureReady}>{azureReady ? "READY" : "NOT CONFIGURED"}</StatusBadge>
        </div>

        {/* Status notice if not ready */}
        {!azureReady && (
          <div style={{ padding: "10px 12px", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: "12px", fontSize: "13px", color: "var(--text-3)", lineHeight: 1.5 }}>
            {azureKeyStatus !== "set"
              ? "Add your Azure Foundry API key in the API Keys tab to enable this model."
              : "Add your Azure Foundry Base URL in the API Keys tab to enable this model."}
          </div>
        )}

        {/* Two-column grid: Model Name + Deployment */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Model Name */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label htmlFor="azure-text-model-name" className="label" style={{ color: "var(--text-3)" }}>
              Model Name
            </label>
            <input
              id="azure-text-model-name"
              type="text"
              placeholder="model-router"
              value={azureTextModelName}
              onChange={(e) => onModelNameChange(e.target.value)}
              style={inputStyle(true)}
              onFocus={focusInput}
              onBlur={blurInput}
            />
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
              Passed as <code style={{ fontFamily: "var(--font-mono)" }}>model</code> in the request body.
            </p>
          </div>

          {/* Deployment */}
          <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
            <label htmlFor="azure-text-deployment" className="label" style={{ color: "var(--text-3)" }}>
              Deployment
            </label>
            <input
              id="azure-text-deployment"
              type="text"
              placeholder="auto-model"
              value={azureTextDeployment}
              onChange={(e) => onDeploymentChange(e.target.value)}
              style={inputStyle(true)}
              onFocus={focusInput}
              onBlur={blurInput}
            />
            <p style={{ fontSize: "12px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
              Used in the URL path <code style={{ fontFamily: "var(--font-mono)" }}>/deployments/{"{deployment}"}</code>.
            </p>
          </div>
        </div>

        {/* API version (read-only) */}
        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
          <span className="label" style={{ color: "var(--text-3)" }}>API Version</span>
          <div style={{ padding: "0 14px", height: "40px", display: "flex", alignItems: "center", background: "var(--bg-1)", border: "1px solid var(--border-1)", borderRadius: "var(--r-pill)", fontSize: "13px", color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
            2024-04-01-preview
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/* ─── Toggle — per components.md > Toggle ────────────────────────────────────── */

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        flexShrink: 0,
        width: "42px",
        height: "24px",
        borderRadius: "var(--r-pill)",
        border: on ? "none" : "1px solid var(--border-2)",
        cursor: "pointer",
        padding: 0,
        position: "relative",
        background: on ? "var(--accent)" : "var(--bg-2)",
        transition: "background var(--dur-1)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "3px",
          left: on ? "auto" : "2px",
          right: on ? "3px" : "auto",
          width: "18px",
          height: "18px",
          borderRadius: "50%",
          background: on ? "var(--on-accent)" : "var(--border-2)",
          transition: "left var(--dur-1), right var(--dur-1)",
        }}
      />
    </button>
  );
}

/* ─── Debug panel ───────────────────────────────────────────────────────────── */

function DebugPanel() {
  const debugMode     = useWorkflowStore((s) => s.debugMode);
  const toggleDebug   = useWorkflowStore((s) => s.toggleDebug);

  return (
    <SectionCard>
      <p style={{ fontSize: "13px", color: "var(--text-3)", margin: 0, lineHeight: 1.5 }}>
        Only visible when <code style={{ fontFamily: "var(--font-mono)", color: "var(--warning)" }}>NEXT_PUBLIC_DEBUG=true</code>
      </p>

      {/* Simulate generation */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "12px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
          <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--text-1)" }}>Simulate generation</span>
          <span style={{ fontSize: "13px", color: "var(--text-3)", lineHeight: 1.5 }}>
            Skip the real API call — fake a 5-second generation and log the payload to the server console.
          </span>
        </div>
        <Toggle on={debugMode} onClick={toggleDebug} />
      </div>
    </SectionCard>
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
  const [codexStatus, setCodexStatus]         = useState<CodexStatus>({ kind: "unknown" });
  const setKieKeySet    = useWorkflowStore((s) => s.setKieKeySet);
  const setAzureKeySet  = useWorkflowStore((s) => s.setAzureKeySet);
  const overlayRef = useRef<HTMLDivElement>(null);

  async function authHeader(): Promise<Record<string, string>> {
    return {};
  }

  const refreshCodexStatus = useCallback(() => {
    fetch("/api/settings/codex-status")
      .then((r) => r.json())
      .then((d: { ready: boolean; installed: boolean; authFound: boolean }) =>
        setCodexStatus(d.ready ? { kind: "ready" } : { kind: "not_ready", installed: d.installed, authFound: d.authFound })
      )
      .catch(() => setCodexStatus({ kind: "not_ready", installed: false, authFound: false }));
  }, []);

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
    // Check whether the server has a working codex-imagegen + codex login
    refreshCodexStatus();
  }, [refreshCodexStatus]);

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
          from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)); }
          to   { opacity: 1; transform: translate(-50%, -50%); }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
      `}</style>

      {/* ── Scrim — the only translucent surface in the system ── */}
      <div
        ref={overlayRef}
        onClick={handleOverlayClick}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "var(--scrim)",
          animation: "settingsOverlayIn var(--dur-2) var(--ease) both",
        }}
      />

      {/* ── Modal shell — 920px, per components.md > Modal ── */}
      <div
        id="settings-modal"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 10000,
          width: "920px",
          maxWidth: "calc(100vw - 40px)",
          maxHeight: "calc(100vh - 40px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "var(--r-3)",
          background: "var(--bg-1)",
          border: "1px solid var(--border-2)",
          overflow: "hidden",
          animation: "settingsModalIn var(--dur-2) var(--ease) both",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "18px 20px",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: "20px", fontWeight: 600, color: "var(--text-1)" }}>Settings</span>
          <button
            id="settings-close"
            onClick={onClose}
            title="Close (Esc)"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "34px",
              height: "34px",
              borderRadius: "var(--r-pill)",
              border: "1px solid var(--border-2)",
              cursor: "pointer",
              background: "transparent",
              color: "var(--text-2)",
              transition: "color 120ms, border-color 120ms",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--text-1)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text-2)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-2)";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Underline tabs, per components.md > Tabs */}
        <div style={{ display: "flex", gap: "4px", padding: "0 20px", borderBottom: "1px solid var(--border-1)", flexShrink: 0 }}>
          {NAV.map((item) => {
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                onClick={() => setActiveNav(item.id)}
                style={{
                  padding: isActive ? "8px 12px 12px" : "8px 12px 12px",
                  marginBottom: isActive ? "-1px" : 0,
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--text-1)" : "2px solid transparent",
                  background: "transparent",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? "var(--text-1)" : "var(--text-3)",
                  fontFamily: "inherit",
                  transition: "color 120ms",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-1)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.color = "var(--text-3)"; }}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
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
              codexStatus={codexStatus}
              onCodexLoginSuccess={refreshCodexStatus}
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
    </>
  );
}
