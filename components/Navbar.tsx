"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

// ── Inner (uses useSearchParams) ──────────────────────────────────────────────

function NavbarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";

  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const debugMode = useWorkflowStore((s) => s.debugMode);
  const toggleDebug = useWorkflowStore((s) => s.toggleDebug);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const setShowDashboard = useWorkflowStore((s) => s.setShowDashboard);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const supabase = createClient();

  // ── Preload heavy route chunks in background ──────────────────────────────

  useEffect(() => {
    // Quietly download the WorkflowCanvas bundle after mount so navigating
    // to "/" doesn't wait on the dynamic import + React Flow parse time.
    const id = setTimeout(() => { void import("@/components/WorkflowCanvas"); }, 1500);
    return () => clearTimeout(id);
  }, []);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.access_token) {
        fetch("/api/settings/kie-key", { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then((r) => r.json())
          .then((d) => setKieKeySet(!!d.hasToken))
          .catch(() => {});
      } else {
        setKieKeySet(null);
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Credits ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: HeadersInit = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const res = await fetch("/api/credit", { headers });
        if (!res.ok) return;
        const data = await res.json();
        const val = typeof data?.data === "number"
          ? data.data
          : (data?.data?.balance ?? data?.balance ?? null);
        setBalance(val);
      } catch { /* ignore */ }
    };
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    window.addEventListener("credits-refresh", fetchBalance);
    return () => {
      clearInterval(id);
      window.removeEventListener("credits-refresh", fetchBalance);
    };
  }, []);

  // ── Dropdown close on outside click ──────────────────────────────────────

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !avatarRef.current?.contains(e.target as Node)
      ) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isWorkflow = pathname === "/";
  const isImages = pathname === "/gallery" && tab !== "videos";
  const isVideos = pathname === "/gallery" && tab === "videos";

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
  };

  return (
    <>
      <style>{NAV_CSS}</style>
      <nav className="tnav">

        {/* ── Logo ── */}
        <div className="tnav-logo">
          <div className="tnav-logo-icon">
            <LogoIcon />
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="tnav-tabs">
          <NavTab href="/gallery?tab=images" active={isImages} icon={<ImagesIcon />}>
            Images
          </NavTab>
          <NavTab href="/gallery?tab=videos" active={isVideos} icon={<VideosIcon />}>
            Videos
          </NavTab>
          <NavTab href="/" active={isWorkflow} icon={<WorkflowIcon />} onClick={() => setShowDashboard(true)}>
            Workflow
          </NavTab>
        </div>

        {/* ── Right section ── */}
        <div className="tnav-right">

          {/* Credits */}
          <div className="tnav-credits">
            <span className="tnav-credits-dot" />
            <span className="tnav-credits-num">
              {balance !== null ? balance.toLocaleString() : "—"}
            </span>
            <span className="tnav-credits-label">credits</span>
          </div>

          {/* Divider */}
          <span className="tnav-divider" />

          {/* Avatar */}
          <div style={{ position: "relative" }}>
            <button
              ref={avatarRef}
              onClick={() => setMenuOpen((o) => !o)}
              className={`tnav-avatar${menuOpen ? " tnav-avatar--open" : ""}`}
              title={user ? "Account" : "Sign in"}
            >
              <UserIcon />
            </button>

            {menuOpen && (
              <div ref={menuRef} className="tnav-dropdown">
                {user && (
                  <div className="tnav-dropdown-header">
                    <p className="tnav-dropdown-label">Signed in as</p>
                    <p className="tnav-dropdown-email">{user.email}</p>
                  </div>
                )}
                <div className="tnav-dropdown-body">
                  <DropdownItem
                    icon={<DebugIcon active={debugMode} />}
                    onClick={() => { toggleDebug(); setMenuOpen(false); }}
                    active={debugMode}
                  >
                    Debug
                  </DropdownItem>
                  <DropdownItem
                    icon={<GearIcon />}
                    onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
                  >
                    Settings
                  </DropdownItem>
                  <div className="tnav-dropdown-sep" />
                  {user ? (
                    <DropdownItem icon={<SignOutIcon />} onClick={signOut} danger>
                      Sign out
                    </DropdownItem>
                  ) : (
                    <DropdownItem
                      icon={<SignInIcon />}
                      onClick={() => { setMenuOpen(false); setAuthModalOpen(true); }}
                    >
                      Sign in
                    </DropdownItem>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}

export default function Navbar() {
  return (
    <Suspense fallback={<div className="tnav-skeleton" />}>
      <NavbarInner />
    </Suspense>
  );
}

// ── NavTab ────────────────────────────────────────────────────────────────────

function NavTab({
  href,
  active,
  icon,
  children,
  onClick,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className={`tnav-tab${active ? " tnav-tab--active" : ""}`}>
      <span className="tnav-tab-icon">{icon}</span>
      {children}
    </Link>
  );
}

// ── DropdownItem ──────────────────────────────────────────────────────────────

function DropdownItem({
  icon,
  children,
  onClick,
  danger = false,
  active = false,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`tnav-dropdown-item${danger ? " tnav-dropdown-item--danger" : ""}${active ? " tnav-dropdown-item--active" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const NAV_CSS = `
  .tnav-skeleton {
    height: 52px;
    background: #1A1A1C;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .tnav {
    display: flex;
    align-items: center;
    height: 52px;
    padding: 0 16px;
    background: #1A1A1C;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
    gap: 0;
    position: relative;
    z-index: 50;
    user-select: none;
  }

  /* ── Logo ── */
  .tnav-logo {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-right: 28px;
    flex-shrink: 0;
  }
  .tnav-logo-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: #ff3df5;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tnav-logo-name {
    font-size: 13.5px;
    font-weight: 600;
    color: #e8e8e6;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  /* ── Tabs ── */
  .tnav-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1;
  }
  .tnav-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 15px;
    font-weight: 450;
    color: rgba(255,255,255,0.45);
    text-decoration: none;
    transition: color 140ms, background 140ms;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .tnav-tab:hover {
    color: rgba(255,255,255,0.72);
    background: rgba(255,255,255,0.05);
  }
  .tnav-tab--active {
    color: #ffffff;
    background: rgba(255,255,255,0.09);
  }
  .tnav-tab--active:hover {
    background: rgba(255,255,255,0.11);
  }
  .tnav-tab-icon {
    display: none;
  }

  /* ── Right ── */
  .tnav-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    margin-left: auto;
  }
  .tnav-credits {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tnav-credits-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #ff3df5;
    flex-shrink: 0;
    box-shadow: 0 0 6px rgba(119,229,68,0.5);
  }
  .tnav-credits-num {
    font-family: var(--font-geist-mono), monospace;
    font-size: 12px;
    color: #e0e0e0;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .tnav-credits-label {
    font-size: 10px;
    color: rgba(255,255,255,0.2);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .tnav-divider {
    width: 1px;
    height: 18px;
    background: rgba(255,255,255,0.07);
    flex-shrink: 0;
  }

  /* ── Avatar ── */
  .tnav-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: #141618;
    border: 1px solid rgba(255,255,255,0.08);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 140ms, border-color 140ms;
    flex-shrink: 0;
    color: #ff3df5;
  }
  .tnav-avatar:hover,
  .tnav-avatar--open {
    background: #1C1F22;
    border-color: rgba(255,255,255,0.14);
  }

  /* ── Dropdown ── */
  .tnav-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 196px;
    background: #0D1012;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4);
    overflow: hidden;
    z-index: 1000;
  }
  .tnav-dropdown-header {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .tnav-dropdown-label {
    font-size: 10px;
    color: #3A3A38;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tnav-dropdown-email {
    font-size: 11px;
    color: #8D8E89;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tnav-dropdown-body {
    padding: 4px;
  }
  .tnav-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #6B6B68;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 120ms, color 120ms;
    font-family: inherit;
  }
  .tnav-dropdown-item:hover {
    background: #141618;
    color: #d0d0d0;
  }
  .tnav-dropdown-item--active {
    color: #ff3df5;
  }
  .tnav-dropdown-item--active:hover {
    color: #ff3df5;
  }
  .tnav-dropdown-item--danger { color: #6B6B68; }
  .tnav-dropdown-item--danger:hover {
    background: #141618;
    color: #f87171;
  }
  .tnav-dropdown-sep {
    height: 1px;
    background: rgba(255,255,255,0.05);
    margin: 4px 8px;
  }
`;

// ── Icons ─────────────────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="#060A06" stroke="none">
      <path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" />
      <path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#060A06" stroke="none">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ImagesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function VideosIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="15" height="14" rx="2" />
      <path d="m17 8 5-3v14l-5-3V8Z" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M6.5 10v4M10 6.5h4M17.5 14v-3.5H10" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
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

function DebugIcon({ active }: { active: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      style={{ color: active ? "#f59e0b" : undefined }}>
      <path d="M12 22c4.97 0 9-4.48 9-10S16.97 2 12 2 3 6.48 3 12s4.03 10 9 10z" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
