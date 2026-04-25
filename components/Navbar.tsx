"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

// ── Inner (uses useSearchParams) ──────────────────────────────────────────────

function NavbarInner() {
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const tab          = searchParams.get("tab") ?? "images";

  const [user, setUser]         = useState<User | null>(null);
  const [balance, setBalance]   = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef   = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const supabase         = createClient();

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Credits ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res  = await fetch("/api/credit");
        if (!res.ok) return;
        const data = await res.json();
        const val  = typeof data?.data === "number"
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
  const isImages   = pathname === "/gallery" && tab !== "videos";
  const isVideos   = pathname === "/gallery" && tab === "videos";

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
  };

  return (
    <>
      <style>{NAV_CSS}</style>
      <nav className="tnav">

        {/* ── Tabs ── */}
        <div className="tnav-tabs">
          <NavTab href="/gallery?tab=images" active={isImages} icon={<ImagesIcon />}>
            Images
          </NavTab>
          <NavTab href="/gallery?tab=videos" active={isVideos} icon={<VideosIcon />}>
            Videos
          </NavTab>
          <NavTab href="/" active={isWorkflow} icon={<WorkflowIcon />}>
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
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`tnav-tab${active ? " tnav-tab--active" : ""}`}>
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
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`tnav-dropdown-item${danger ? " tnav-dropdown-item--danger" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const NAV_CSS = `
  .tnav-skeleton {
    height: 48px;
    background: #080A0C;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }

  .tnav {
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 16px;
    background: #080A0C;
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
    background: #77E544;
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
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    color: rgba(255,255,255,0.32);
    text-decoration: none;
    transition: color 140ms, background 140ms;
    white-space: nowrap;
    letter-spacing: -0.005em;
  }
  .tnav-tab:hover {
    color: rgba(255,255,255,0.65);
    background: rgba(255,255,255,0.04);
  }
  .tnav-tab--active {
    color: #ffffff;
  }
  .tnav-tab--active:hover {
    background: rgba(255,255,255,0.05);
  }
  .tnav-tab-icon {
    display: flex;
    align-items: center;
    opacity: 0.7;
  }
  .tnav-tab--active .tnav-tab-icon {
    opacity: 1;
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
    background: #77E544;
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
    color: #77E544;
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
  .tnav-dropdown-item--danger { color: #6B6B68; }
  .tnav-dropdown-item--danger:hover {
    background: #141618;
    color: #f87171;
  }
`;

// ── Icons ─────────────────────────────────────────────────────────────────────

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

function SignInIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}
