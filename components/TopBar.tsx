"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

interface TopBarProps {
  isRunning: boolean;
  canRun: boolean;
  onRunAll: () => void;
  hasNodes: boolean;
  onClear: () => void;
  debugMode: boolean;
  onToggleDebug: () => void;
  onOpenSettings: () => void;
}

export default function TopBar({
  isRunning, canRun, onRunAll, hasNodes, onClear, debugMode, onToggleDebug, onOpenSettings,
}: TopBarProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const prevRunning = useRef(false);

  // Counter-scale against browser zoom so the bar stays visually fixed-size
  const initialDPR = useRef(typeof window !== "undefined" ? window.devicePixelRatio : 1);
  const [counterZoom, setCounterZoom] = useState(1);
  useEffect(() => {
    const update = () => {
      const browserZoom = window.devicePixelRatio / initialDPR.current;
      setCounterZoom(1 / browserZoom);
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const setResetPasswordModalOpen = useWorkflowStore((s) => s.setResetPasswordModalOpen);
  const supabase = createClient();

  // Auth
  useEffect(() => {
    if (window.location.hash.includes("type=recovery")) {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        supabase.auth.setSession({ access_token, refresh_token }).then(() => {
          setResetPasswordModalOpen(true);
        });
      } else {
        setResetPasswordModalOpen(true);
      }
    }
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthLoaded(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setResetPasswordModalOpen(true);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Credits
  const fetchBalance = async () => {
    try {
      const res = await fetch("/api/credit");
      if (!res.ok) return;
      const data = await res.json();
      const val = typeof data?.data === "number" ? data.data : (data?.data?.balance ?? data?.balance ?? null);
      setBalance(val);
    } catch { /* silently ignore */ }
  };

  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh credits when a run finishes
  useEffect(() => {
    if (prevRunning.current && !isRunning) fetchBalance();
    prevRunning.current = isRunning;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !avatarRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "44px",
        padding: "0 14px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        background: "#080A0C",
        flexShrink: 0,
        userSelect: "none",
        position: "relative",
        zIndex: 10,
        zoom: counterZoom,
      }}
    >
      {/* ── Credits ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
        <span
          style={{
            width: "6px", height: "6px", borderRadius: "50%",
            background: "#77E544", flexShrink: 0,
            boxShadow: "0 0 6px rgba(119,229,68,0.45)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: "12px",
            color: "#e0e0e0",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.01em",
          }}
        >
          {balance !== null ? balance.toLocaleString() : "—"}
        </span>
        <span style={{ fontSize: "11px", color: "#3E3E3A" }}>credits</span>
      </div>

      {/* ── Actions + Avatar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        {/* Debug toggle */}
        <button
          onClick={onToggleDebug}
          className={`toolbar-btn flex items-center gap-1.5 ${debugMode ? "!border-amber-500/60 !text-amber-400" : ""}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${debugMode ? "bg-amber-400" : "bg-[#333333]"}`} />
          Debug
        </button>

        {hasNodes && (
          <button onClick={onClear} disabled={isRunning} className="toolbar-btn">
            Clear
          </button>
        )}

        <button onClick={onRunAll} disabled={!canRun} className="toolbar-btn-primary">
          {isRunning ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-[#2A1A14] border-t-transparent rounded-full animate-spin" />
              Running
            </span>
          ) : (
            "Run all"
          )}
        </button>

        {/* Divider */}
        <span
          style={{
            width: "1px", height: "20px",
            background: "rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        />

        {/* User avatar */}
        <div style={{ position: "relative" }}>
          <button
            ref={avatarRef}
            onClick={() => setMenuOpen((o) => !o)}
            title={user ? "User menu" : "Sign in"}
            style={{
              width: "28px", height: "28px",
              borderRadius: "50%",
              background: menuOpen ? "#1A1C20" : "#111416",
              border: `1px solid ${menuOpen ? "#2E2E2E" : "#1E1E1E"}`,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "background 150ms, border-color 150ms",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background = "#161A1D";
                e.currentTarget.style.borderColor = "#2A2A2A";
              }
            }}
            onMouseLeave={(e) => {
              if (!menuOpen) {
                e.currentTarget.style.background = "#111416";
                e.currentTarget.style.borderColor = "#1E1E1E";
              }
            }}
          >
            <svg
              width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="#77E544" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20a8 8 0 0 1 16 0" />
            </svg>
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                width: "188px",
                background: "#0D1012",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "10px",
                boxShadow: "0 12px 40px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4)",
                overflow: "hidden",
                zIndex: 1000,
              }}
            >
              {authLoaded && user && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  <p style={{ fontSize: "10px", color: "#3A3A38", marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Signed in as
                  </p>
                  <p style={{ fontSize: "11px", color: "#8D8E89", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.email}
                  </p>
                </div>
              )}

              <div style={{ padding: "4px" }}>
                <Link
                  href="/gallery"
                  style={{ textDecoration: "none", display: "block" }}
                  onClick={() => setMenuOpen(false)}
                >
                  <MenuItem icon={<GalleryIcon />} onClick={() => {}}>
                    Gallery
                  </MenuItem>
                </Link>

                <MenuItem
                  icon={<SettingsIcon />}
                  onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                >
                  Settings
                </MenuItem>

                {authLoaded && (
                  user ? (
                    <MenuItem icon={<SignOutIcon />} onClick={signOut} danger>
                      Sign out
                    </MenuItem>
                  ) : (
                    <MenuItem
                      icon={<SignInIcon />}
                      onClick={() => { setMenuOpen(false); setAuthModalOpen(true); }}
                    >
                      Sign in
                    </MenuItem>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Menu item ────────────────────────────────────────────────────────────────

function MenuItem({
  icon,
  children,
  onClick,
  danger = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "7px 8px",
        borderRadius: "6px",
        border: "none",
        background: hovered ? "#141618" : "transparent",
        color: danger
          ? (hovered ? "#f87171" : "#6B6B68")
          : (hovered ? "#d0d0d0" : "#6B6B68"),
        fontSize: "12px",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 120ms, color 120ms",
        fontFamily: "inherit",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function GalleryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function SignInIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}
