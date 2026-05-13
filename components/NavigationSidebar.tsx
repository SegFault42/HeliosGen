"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

import { 
  Workflow, 
  Image as ImageIconLucide, 
  Video as VideoIconLucide, 
  Package, 
  MessageSquare, 
  User as UserIconLucide, 
  ChevronDown, 
  ChevronLeft, 
  LogOut, 
  Settings 
} from "lucide-react";

// ── Icons ─────────────────────────────────────────────────────────────────────

function LogoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 20 20" fill="#ff3df5" stroke="none">
      <path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" />
    </svg>
  );
}

function ImageIcon() {
  return <ImageIconLucide size={20} />;
}

function VideoIcon() {
  return <VideoIconLucide size={20} />;
}

function WorkflowIcon() {
  return <Workflow size={20} />;
}

function AssetsIcon() {
  return <Package size={20} />;
}

function ChatIcon() {
  return <MessageSquare size={20} />;
}

function UserIcon() {
  return <UserIconLucide size={20} />;
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <ChevronDown
      size={16}
      style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s" }}
    />
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <ChevronLeft
      size={14}
      strokeWidth={2.5}
      style={{ transform: collapsed ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}
    />
  );
}

function SignOutIcon() {
  return <LogOut size={16} />;
}

function GearIcon() {
  return <Settings size={16} />;
}


// ── Sidebar Inner ─────────────────────────────────────────────────────────────

function NavigationSidebarInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";

  const [user, setUser] = useState<User | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  
  const collapsed = useWorkflowStore((s) => s.sidebarCollapsed);
  const setCollapsed = useWorkflowStore((s) => s.setSidebarCollapsed);
  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const setShowDashboard = useWorkflowStore((s) => s.setShowDashboard);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const supabase = createClient();

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

  const isWorkflow = pathname === "/";
  const isImage = pathname === "/gallery" && tab === "images";
  const isVideo = pathname === "/gallery" && tab === "videos";

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMenuOpen(false);
  };

  return (
    <>
      <style>{SIDEBAR_CSS}</style>
      <aside className={`nav-sidebar ${collapsed ? "nav-sidebar--collapsed" : ""}`}>
        
        {/* ── Top Section: Logo ── */}
        <div className="nav-sidebar-header" style={{ justifyContent: collapsed ? "center" : "flex-start", padding: collapsed ? "0" : "0 16px" }}>
          <div className="nav-sidebar-logo" style={{ minWidth: "auto" }}>
            <LogoIcon />
            {!collapsed && <span className="nav-sidebar-brand">HeliosGen</span>}
          </div>
        </div>

        <button 
          className="nav-sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
        >
          <CollapseIcon collapsed={collapsed} />
        </button>

        {/* ── Main Nav ── */}
        <div className="nav-sidebar-content">
          
          {/* Workflow */}
          <SidebarItem 
            href="/" 
            active={isWorkflow} 
            icon={<WorkflowIcon />} 
            label="Workflow" 
            collapsed={collapsed}
            onClick={() => setShowDashboard(true)}
          />

          {/* Image */}
          <SidebarItem 
            href="/gallery?tab=images" 
            active={isImage} 
            icon={<ImageIcon />} 
            label="Image" 
            collapsed={collapsed}
          />

          {/* Video */}
          <SidebarItem 
            href="/gallery?tab=videos" 
            active={isVideo} 
            icon={<VideoIcon />} 
            label="Video" 
            collapsed={collapsed}
          />

          {/* Assets */}
          <SidebarItem 
            href="#" 
            active={false} 
            icon={<AssetsIcon />} 
            label="Assets" 
            collapsed={collapsed}
            disabled
          />

          {/* Chat */}
          <SidebarItem 
            href="#" 
            active={false} 
            icon={<ChatIcon />} 
            label="Chat" 
            collapsed={collapsed}
            disabled
          />

        </div>

        {/* ── Bottom Section: User & Credits ── */}
        <div className="nav-sidebar-footer">
          
          {/* Credits */}
          {!collapsed && (
            <div className="nav-sidebar-credits">
              <span className="nav-sidebar-credits-dot" />
              <div className="nav-sidebar-credits-text">
                <span className="nav-sidebar-credits-num">
                  {balance !== null ? balance.toLocaleString() : "—"}
                </span>
                <span className="nav-sidebar-credits-label">credits left</span>
              </div>
            </div>
          )}

          {/* User Button */}
          <div className="nav-sidebar-user">
            <button 
              className={`nav-sidebar-user-btn ${menuOpen ? "nav-sidebar-user-btn--open" : ""}`}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <div className="nav-sidebar-user-avatar">
                <UserIcon />
              </div>
              {!collapsed && (
                <div className="nav-sidebar-user-info">
                  <span className="nav-sidebar-user-email">
                    {user ? user.email : "Sign in"}
                  </span>
                </div>
              )}
            </button>

            {menuOpen && (
              <div className="nav-sidebar-dropdown">
                {user && (
                  <div className="nav-sidebar-dropdown-header">
                    <p className="nav-sidebar-dropdown-label">Signed in as</p>
                    <p className="nav-sidebar-dropdown-email">{user.email}</p>
                  </div>
                )}
                <div className="nav-sidebar-dropdown-body">
                  <DropdownItem
                    icon={<GearIcon />}
                    onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}
                  >
                    Settings
                  </DropdownItem>
                  <div className="nav-sidebar-dropdown-sep" />
                  {user ? (
                    <DropdownItem icon={<SignOutIcon />} onClick={signOut} danger>
                      Sign out
                    </DropdownItem>
                  ) : (
                    <DropdownItem
                      icon={<GearIcon />} // Reuse an icon or just text
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

      </aside>
    </>
  );
}

export default function NavigationSidebar() {
  return (
    <Suspense fallback={<div className="nav-sidebar-skeleton" />}>
      <NavigationSidebarInner />
    </Suspense>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

function SidebarItem({ 
  href, 
  active, 
  icon, 
  label, 
  collapsed, 
  onClick, 
  disabled = false,
}: { 
  href: string; 
  active: boolean; 
  icon: React.ReactNode; 
  label: string; 
  collapsed: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className="nav-sidebar-item-icon">{icon}</span>
      {!collapsed && <span className="nav-sidebar-item-label">{label}</span>}
    </>
  );

  if (disabled) {
    return <div className={`nav-sidebar-item nav-sidebar-item--disabled ${active ? "nav-sidebar-item--active" : ""}`}>{content}</div>;
  }

  return (
    <Link href={href} onClick={onClick} className={`nav-sidebar-item ${active ? "nav-sidebar-item--active" : ""}`}>
      {content}
    </Link>
  );
}

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
      className={`nav-sidebar-dropdown-item${danger ? " nav-sidebar-dropdown-item--danger" : ""}`}
    >
      {icon}
      {children}
    </button>
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const SIDEBAR_CSS = `
  .nav-sidebar {
    width: 240px;
    background: #0A0C0E;
    border-right: 1px solid rgba(255,255,255,0.05);
    display: flex;
    flex-direction: column;
    height: 100vh;
    flex-shrink: 0;
    transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 100;
    user-select: none;
    position: relative;
  }

  .nav-sidebar--collapsed {
    width: 68px;
  }

  .nav-sidebar-skeleton {
    width: 240px;
    background: #0A0C0E;
    border-right: 1px solid rgba(255,255,255,0.05);
    height: 100vh;
  }

  /* ── Header ── */
  .nav-sidebar-header {
    height: 64px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.03);
    overflow: hidden;
  }

  .nav-sidebar-logo {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-sidebar-brand {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.01em;
  }

  .nav-sidebar-collapse-btn {
    position: absolute;
    right: -12px;
    top: 20px;
    width: 24px;
    height: 24px;
    background: #0D1012;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 50%;
    color: rgba(255,255,255,0.5);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 101;
    padding: 0;
  }

  .nav-sidebar-collapse-btn:hover {
    background: rgba(255,255,255,0.1);
    color: #fff;
  }

  /* ── Content ── */
  .nav-sidebar-content {
    flex: 1;
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .nav-sidebar-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-radius: 10px;
    color: rgba(255,255,255,0.5);
    text-decoration: none;
    transition: background 0.2s, color 0.2s;
    font-size: 14px;
    font-weight: 500;
    gap: 12px;
    white-space: nowrap;
    position: relative;
  }

  .nav-sidebar-item:hover {
    background: rgba(255,255,255,0.04);
    color: rgba(255,255,255,0.8);
  }

  .nav-sidebar-item--active {
    background: rgba(255,255,255,0.08);
    color: #fff;
  }

  .nav-sidebar-item--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .nav-sidebar-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
  }

  .nav-sidebar-item-toggle {
    margin-left: auto;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .nav-sidebar-item-toggle:hover {
    background: rgba(255,255,255,0.1);
  }

  /* ── Footer ── */
  .nav-sidebar-footer {
    padding: 16px 12px;
    border-top: 1px solid rgba(255,255,255,0.03);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .nav-sidebar-credits {
    padding: 12px;
    background: rgba(255,255,255,0.03);
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .nav-sidebar-credits-dot {
    width: 8px;
    height: 8px;
    background: #ff3df5;
    border-radius: 50%;
    box-shadow: 0 0 8px rgba(255,61,245,0.5);
  }

  .nav-sidebar-credits-text {
    display: flex;
    flex-direction: column;
  }

  .nav-sidebar-credits-num {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    font-family: var(--font-geist-mono);
  }

  .nav-sidebar-credits-label {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  /* ── User ── */
  .nav-sidebar-user {
    position: relative;
  }

  .nav-sidebar-user-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px;
    border-radius: 12px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.05);
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-align: left;
    overflow: hidden;
  }

  .nav-sidebar-user-btn:hover,
  .nav-sidebar-user-btn--open {
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.1);
  }

  .nav-sidebar-user-avatar {
    width: 32px;
    height: 32px;
    background: #141618;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ff3df5;
    flex-shrink: 0;
  }

  .nav-sidebar-user-info {
    flex: 1;
    min-width: 0;
  }

  .nav-sidebar-user-email {
    display: block;
    font-size: 13px;
    color: rgba(255,255,255,0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Dropdown ── */
  .nav-sidebar-dropdown {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: 216px;
    background: #0D1012;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4);
    overflow: hidden;
    z-index: 1000;
  }

  .nav-sidebar-dropdown-header {
    padding: 12px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .nav-sidebar-dropdown-label {
    font-size: 10px;
    color: rgba(255,255,255,0.3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .nav-sidebar-dropdown-email {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-sidebar-dropdown-body {
    padding: 6px;
  }

  .nav-sidebar-dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.5);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s, color 0.2s;
  }

  .nav-sidebar-dropdown-item:hover {
    background: rgba(255,255,255,0.05);
    color: #fff;
  }

  .nav-sidebar-dropdown-item--danger:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .nav-sidebar-dropdown-sep {
    height: 1px;
    background: rgba(255,255,255,0.05);
    margin: 6px;
  }
`;
