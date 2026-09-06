"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * "Update available" bar, styled like {@link KieBanner} but amber.
 * Polls `/api/update-check` (GitHub latest release vs the bundled version);
 * tapping the bar opens a modal with the release notes and a Download link.
 * No self-install — Download just opens the release page in the OS browser
 * (caught by {@link DesktopLinkHandler}).
 */

const DISMISS_KEY = "helios-update-dismissed"; // holds the version the user dismissed

const AMBER = "245,158,11";

type UpdateInfo = {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  name?: string;
  notes?: string;
  url?: string;
  publishedAt?: string;
};

export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/update-check")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UpdateInfo | null) => {
        if (!alive || !d?.updateAvailable) return;
        try {
          if (localStorage.getItem(DISMISS_KEY) === d.latestVersion) setDismissed(true);
        } catch {
          /* private mode — just show it */
        }
        setInfo(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!info?.updateAvailable || dismissed) return null;

  const dismiss = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    try {
      if (info.latestVersion) localStorage.setItem(DISMISS_KEY, info.latestVersion);
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "9px 16px",
          background: `rgba(${AMBER},0.12)`,
          border: "none",
          borderBottom: `1px solid rgba(${AMBER},0.3)`,
          cursor: "pointer",
          transition: "background 150ms",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = `rgba(${AMBER},0.18)`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = `rgba(${AMBER},0.12)`;
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={`rgba(${AMBER},0.95)`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span style={{ fontSize: "12px", color: `rgba(${AMBER},0.95)`, fontWeight: 500 }}>
          Update available{info.latestVersion ? ` — ${info.latestVersion}` : ""}
        </span>
        <span
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: `rgba(${AMBER},0.75)`,
            background: `rgba(${AMBER},0.12)`,
            border: `1px solid rgba(${AMBER},0.25)`,
            borderRadius: "5px",
            padding: "2px 8px",
            marginLeft: "4px",
          }}
        >
          View changes →
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          onClick={dismiss}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") dismiss(e);
          }}
          style={{
            marginLeft: "8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "18px",
            height: "18px",
            borderRadius: "5px",
            color: `rgba(${AMBER},0.6)`,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `rgba(${AMBER},0.15)`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </span>
      </button>

      {open && <ChangelogModal info={info} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Compact update action in the Settings sidebar. */
export function LocalUpdateButton() {
  const [state, setState] = useState({ available: false, running: false, message: "", error: false });
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = () => fetch("/api/app-update", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((s) => { if (alive) setState(s); })
      .catch(() => { /* The sidecar is briefly offline during app replacement. */ });
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  async function update() {
    setConfirming(false);
    setRequested(true);
    setStarting(true);
    try {
      const response = await fetch("/api/app-update", {
        method: "POST", headers: { "x-helios-update": "1" },
        signal: AbortSignal.timeout(10000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not start update.");
      setState((s) => ({ ...s, running: true, error: false, message: result.message }));
    } catch (error) {
      setState((s) => ({ ...s, error: true, message: (error as Error).message }));
    } finally { setStarting(false); }
  }

  if (!state.available) return (
    <a href="https://github.com/SegFault42/HeliosGen/releases/latest"
      style={{ marginTop: "auto", padding: "24px 10px 8px", fontSize: 12, color: "rgba(255,255,255,0.5)", textDecoration: "none" }}>
      Check for updates ↗
    </a>
  );

  return <><div style={{ marginTop: "auto", paddingTop: 16 }}>
    <button onClick={() => setConfirming(true)} disabled={!state.available || state.running || starting}
      title={!state.available ? "Restore the local source checkout to enable updates" : "Install the latest stable release and restart"}
      style={{ width: "100%", textAlign: "left", fontSize: 12, fontWeight: 400, padding: "8px 10px", borderRadius: 7,
        border: "none", background: "transparent", color: "rgba(255,255,255,0.5)",
        cursor: state.running || starting || !state.available ? "default" : "pointer", opacity: state.running || starting || !state.available ? 0.6 : 1 }}>
      {state.running || starting ? "Updating…" : "Update HeliosGen"}
    </button>
    {(requested || state.running || state.error) && <span role="status" aria-live="polite"
      style={{ display: "block", padding: "4px 10px", fontSize: 11, overflowWrap: "anywhere", color: state.error ? "#f87171" : "rgba(255,255,255,0.4)" }}>
      {state.message}
    </span>}
  </div>
    {confirming && createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 10001, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.7)" }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="update-title" aria-describedby="update-description"
        style={{ width: "min(90vw, 460px)", padding: 24, borderRadius: 16, background: "#0a0b0e", border: "1px solid rgba(255,255,255,0.15)", color: "#eee" }}>
        <h2 id="update-title" style={{ fontSize: 17, fontWeight: 600 }}>Update HeliosGen?</h2>
        <p id="update-description" style={{ fontSize: 13, lineHeight: 1.6, margin: "16px 0", color: "#aaa" }}>
          Save your work and finish any generations first. If a new stable release is available,
          it will build and install automatically, then restart the app. This can take several minutes.
          Your media and settings stay in place; the database and previous app are backed up.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button autoFocus onClick={() => setConfirming(false)} style={{ padding: "8px 14px", color: "#ccc", cursor: "pointer" }}>Cancel</button>
          <button onClick={update} style={{ padding: "8px 14px", borderRadius: 8, color: `rgb(${AMBER})`, background: `rgba(${AMBER},0.15)`, border: `1px solid rgba(${AMBER},0.4)`, cursor: "pointer" }}>Check and install update</button>
        </div>
      </div>
    </div>, document.body)}
  </>;
}

function ChangelogModal({ info, onClose }: { info: UpdateInfo; onClose: () => void }) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          zIndex: 10000,
          width: "min(90vw, 560px)",
          maxHeight: "min(80vh, 640px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px",
          background: "rgba(10,11,14,0.98)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 4px 20px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "18px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={`rgba(${AMBER},0.95)`} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.95)" }}>
              {info.name || "Update available"}
            </div>
            <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "2px" }}>
              {info.currentVersion} → {info.latestVersion}
              {info.publishedAt ? ` · ${new Date(info.publishedAt).toLocaleDateString()}` : ""}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "26px",
              height: "26px",
              borderRadius: "7px",
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Notes */}
        <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
          <Notes text={info.notes || "No release notes provided."} />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "8px",
            padding: "14px 20px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 500,
              padding: "7px 14px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "rgba(255,255,255,0.7)",
              cursor: "pointer",
            }}
          >
            Later
          </button>
          {/* No target="_blank": DesktopLinkHandler intercepts the click and
              hands the URL to the OS browser via /api/open-external. A _blank
              would also trigger Tauri's own (unpermitted) shell.open. */}
          <a
            href={info.url}
            onClick={onClose}
            style={{
              fontSize: "12px",
              fontWeight: 600,
              padding: "7px 14px",
              borderRadius: "8px",
              border: `1px solid rgba(${AMBER},0.4)`,
              background: `rgba(${AMBER},0.15)`,
              color: `rgba(${AMBER},0.95)`,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            Download
          </a>
        </div>
      </div>
    </>
  );
}

/** Minimal, safe Markdown-ish renderer for a GitHub release body. */
function Notes({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return (
    <div style={{ fontSize: "12.5px", lineHeight: 1.6, color: "rgba(255,255,255,0.8)" }}>
      {lines.map((raw, i) => {
        const line = raw.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
        const heading = line.match(/^#{1,6}\s+(.*)/);
        if (heading) {
          return (
            <div key={i} style={{ fontWeight: 600, color: "rgba(255,255,255,0.95)", margin: i ? "12px 0 4px" : "0 0 4px" }}>
              {heading[1]}
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)/);
        if (bullet) {
          return (
            <div key={i} style={{ display: "flex", gap: "8px", padding: "1px 0" }}>
              <span style={{ color: `rgba(${AMBER},0.7)` }}>•</span>
              <span>{bullet[1]}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} style={{ height: "8px" }} />;
        return (
          <div key={i} style={{ padding: "1px 0" }}>
            {line}
          </div>
        );
      })}
    </div>
  );
}
