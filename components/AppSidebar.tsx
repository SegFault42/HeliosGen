"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import { useChatSessionStore } from "@/lib/chatSessionStore";
import type { User } from "@supabase/supabase-js";
import {
  Workflow,
  Image as ImageIcon,
  Video as VideoIcon,
  Package,
  MessageSquare,
  Settings,
  MoreHorizontal,
  LogOut,
  User as UserIcon,
  Bot,
  Pencil,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";

// ── Deterministic pixel-art avatar ───────────────────────────────────────────
function fnv1a(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function PixelAvatar({ seed, size = 36 }: { seed: string; size?: number }) {
  const rand = lcg(fnv1a(seed || "guest"));
  const hue1 = Math.floor(rand() * 360);
  const hue2 = (hue1 + 100 + Math.floor(rand() * 120)) % 360;

  const palette = [
    `hsl(${hue1}, 22%, 10%)`,  // 0 = bg
    `hsl(${hue1}, 68%, 58%)`,  // 1 = primary
    `hsl(${hue2}, 62%, 48%)`,  // 2 = secondary
    `hsl(${hue1}, 18%, 5%)`,   // 3 = dark
  ];

  const ROWS = 8, COLS = 8, HALF = 4;
  const cells: number[][] = Array.from({ length: ROWS }, () => {
    const row = new Array(COLS).fill(0);
    for (let c = 0; c < HALF; c++) {
      const v = Math.floor(rand() * 4);
      row[c] = v;
      row[COLS - 1 - c] = v;
    }
    return row;
  });

  const px = size / COLS;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", imageRendering: "pixelated" }}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.flatMap((row, r) =>
        row.map((v, c) =>
          v === 0 ? null : (
            <rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} fill={palette[v]} />
          )
        )
      )}
    </svg>
  );
}

// ── Static icons ──────────────────────────────────────────────────────────────
function LogoIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 20 20" fill="#2DD4BF" stroke="none">
      <path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" />
    </svg>
  );
}

function CreditIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// ── Sidebar component ─────────────────────────────────────────────────────────
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";
  const activeChatId = searchParams.get("id");

  const [user, setUser] = React.useState<User | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);

  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const supabase = createClient();

  React.useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      if (data.user) useChatSessionStore.getState().loadFromSupabase();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.access_token) {
        fetch("/api/settings/kie-key", { headers: { Authorization: `Bearer ${session.access_token}` } })
          .then((r) => r.json())
          .then((d) => setKieKeySet(!!d.hasToken))
          .catch(() => {});
        useChatSessionStore.getState().loadFromSupabase();
      } else {
        setKieKeySet(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, setKieKeySet]);

  React.useEffect(() => {
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
    return () => { clearInterval(id); window.removeEventListener("credits-refresh", fetchBalance); };
  }, [supabase]);

  const signOut = async () => { await supabase.auth.signOut(); setUser(null); };

  const { sessions, deleteSession } = useChatSessionStore();

  function startNewChat() {
    router.push("/chat");
  }

  function handleDeleteChat(id: string, isActive: boolean) {
    deleteSession(id);
    if (isActive) {
      const next = sessions.find(s => s.id !== id);
      router.push(next ? `/chat?id=${next.id}` : "/chat");
    }
  }

  const displayName = user
    ? (user.user_metadata?.full_name || user.email?.split("@")[0] || "User")
    : "Guest User";

  const avatarSeed = user?.id || "guest";

  const navItems = [
    { label: "Workflow", href: "/", icon: Workflow, active: pathname === "/" || pathname.startsWith("/workflow") },
    { label: "Image", href: "/gallery?tab=images", icon: ImageIcon, active: pathname === "/gallery" && tab === "images" },
    { label: "Video", href: "/gallery?tab=videos", icon: VideoIcon, active: pathname === "/gallery" && tab === "videos" },
    { label: "Assets", href: "#", icon: Package, active: false, disabled: true },
    { label: "Chat", href: "/chat", icon: MessageSquare, active: pathname === "/chat" },
    { label: "Settings", href: "#", icon: Settings, active: false, onClick: (e: React.MouseEvent) => { e.preventDefault(); setSettingsOpen(true); } },
  ];

  const itemCls = (active: boolean, disabled?: boolean) => cn(
    "flex items-center gap-3.5 px-3 h-11 w-full rounded-xl transition-colors duration-150 text-left",
    "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:mx-auto",
    active ? "bg-white/[0.08] text-white" : "text-white/50 hover:text-white/80 hover:bg-white/[0.05]",
    disabled && "opacity-35 cursor-not-allowed pointer-events-none",
  );

  return (
    <Sidebar collapsible="icon" className="border-r-0 bg-[#0B0E14]" style={{ borderRight: "none" }}>

      {/* ── Header ── */}
      <SidebarHeader className="flex-row items-center justify-between px-4 pt-5 pb-2 gap-0">
        <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:hidden">
          <LogoIcon />
          <span className="text-white text-[22px] leading-none select-none"
            style={{ fontFamily: "'Georgia','Times New Roman',serif", fontStyle: "italic" }}>
            HeliosGen
          </span>
        </div>
        {/* Collapsed: logo fades to trigger on hover */}
        <div className="hidden group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:py-1">
          <div className="relative group/logo-area w-10 h-10 flex items-center justify-center">
            <div className="pointer-events-none transition-opacity duration-200 group-hover/logo-area:opacity-0">
              <LogoIcon />
            </div>
            <SidebarTrigger className="absolute inset-0 opacity-0 group-hover/logo-area:opacity-100 transition-opacity duration-200 text-white/50 hover:text-white hover:bg-white/[0.05] w-full h-full rounded-xl p-0 [&_svg]:size-4" />
          </div>
        </div>
        <SidebarTrigger className="group-data-[collapsible=icon]:hidden text-white/30 hover:text-white/70 hover:bg-white/[0.05] transition-colors p-1.5 rounded-lg -mr-1 [&_svg]:size-4" />
      </SidebarHeader>

      {/* ── Nav + Chat history ── */}
      <SidebarContent className="overflow-hidden flex flex-col">
        {/* Nav items */}
        <div className="px-2 py-3 flex flex-col gap-0.5 shrink-0">
          {navItems.map((item) => {
            const content = (
              <>
                {React.createElement(item.icon, { size: 20, strokeWidth: 1.5, className: "shrink-0" })}
                <span className="text-[14px] font-medium group-data-[collapsible=icon]:hidden leading-none">
                  {item.label}
                </span>
              </>
            );
            if (item.disabled) return (
              <div key={item.label} className={itemCls(item.active, true)} title={item.label}>{content}</div>
            );
            if (!item.href || item.href === "#") return (
              <button key={item.label} className={itemCls(item.active)} onClick={item.onClick} title={item.label}>{content}</button>
            );
            return (
              <Link key={item.label} href={item.href} onClick={item.onClick} className={itemCls(item.active)} title={item.label}>{content}</Link>
            );
          })}
        </div>

        {/* Chat history — hidden in icon mode */}
        <div className="group-data-[collapsible=icon]:hidden flex flex-col flex-1 min-h-0 px-2 pb-2">
          <div className="border-t border-white/[0.06] mb-1" />

          {/* Section header */}
          <div className="flex items-center justify-between px-1 py-2 shrink-0">
            <span className="text-[10px] font-bold tracking-[0.08em] uppercase text-white/25">Chats</span>
            <button
              onClick={startNewChat}
              title="New chat"
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/[0.06] transition-colors"
            >
              <Pencil size={12} />
            </button>
          </div>

          {/* Session list */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 min-h-0">
            {sessions.length === 0 ? (
              <p className="text-center text-[11px] text-white/20 px-2 py-4">No chats yet</p>
            ) : sessions.map(sess => {
              const isActive = pathname === "/chat" && sess.id === activeChatId;
              return (
                <div
                  key={sess.id}
                  onClick={() => router.push(`/chat?id=${sess.id}`)}
                  className={cn(
                    "group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors",
                    isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                  )}
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: "rgba(45,212,191,0.08)", border: "1px solid rgba(45,212,191,0.12)" }}>
                    <Bot size={11} style={{ color: "rgba(45,212,191,0.7)" }} />
                  </div>
                  <span className={cn(
                    "flex-1 text-[12px] truncate leading-tight",
                    isActive ? "text-white/90" : "text-white/55"
                  )}>
                    {sess.title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteChat(sess.id, isActive); }}
                    className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400/70 hover:bg-red-400/10 transition-all shrink-0"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </SidebarContent>

      {/* ── Footer ── */}
      <SidebarFooter className="px-2 pb-4">
        <DropdownMenu>

          {/* Trigger: pixel avatar + name + credits */}
          <DropdownMenuTrigger
            render={
              <button
                title={displayName}
                className={cn(
                  "flex items-center gap-3 w-full px-2.5 py-2 rounded-xl hover:bg-white/[0.05] transition-colors cursor-pointer",
                  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:w-10 group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:mx-auto",
                )}
              >
                <Avatar className="size-9 rounded-xl shrink-0 after:rounded-xl after:border-white/15">
                  <AvatarFallback className="rounded-xl bg-transparent p-0 overflow-hidden">
                    <PixelAvatar seed={avatarSeed} size={36} />
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left group-data-[collapsible=icon]:hidden min-w-0">
                  <div className="text-[13px] font-semibold text-white/90 truncate leading-tight">{displayName}</div>
                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-white/40">
                    <CreditIcon />
                    <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                  </div>
                </div>
                <MoreHorizontal size={15} className="text-white/30 shrink-0 group-data-[collapsible=icon]:hidden" />
              </button>
            }
          />

          {/* Menu popup */}
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="!p-0 !rounded-2xl !bg-[#0f0f0f] !border-white/[0.12] !ring-0 !shadow-[0_8px_48px_rgba(0,0,0,0.85)] overflow-hidden !w-auto !min-w-[280px]"
          >
            {/* User header — non-interactive */}
            <div className="flex items-center gap-3.5 px-4 pt-4 pb-3.5">
              <Avatar className="size-14 rounded-xl shrink-0 after:rounded-xl after:border-white/15">
                <AvatarFallback className="rounded-xl bg-transparent p-0 overflow-hidden">
                  <PixelAvatar seed={avatarSeed} size={56} />
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-white truncate">{displayName}</div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[12px] text-white/40">
                  <CreditIcon size={13} />
                  <span>{balance !== null ? `${balance.toLocaleString()} Credits` : "0 Credits"}</span>
                </div>
              </div>
            </div>

            <DropdownMenuSeparator className="!bg-white/[0.07] !my-0 !mx-0" />

            {/* Purchase Kie Credits */}
            <DropdownMenuItem
              className="flex items-center justify-between rounded-none px-4 py-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
              onClick={() => window.open("https://kie.ai?ref=25abb3f2236cbff9780ab9c2f84479ec", "_blank")}
            >
              <span>Purchase Kie Credits</span>
              <CreditIcon size={15} />
            </DropdownMenuItem>

            <DropdownMenuSeparator className="!bg-white/[0.07] !my-0 !mx-0" />

            {/* Settings */}
            <DropdownMenuItem
              className="rounded-none px-4 py-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
              onClick={() => setSettingsOpen(true)}
            >
              Settings
            </DropdownMenuItem>

            <DropdownMenuSeparator className="!bg-white/[0.07] !my-0 !mx-0" />

            {/* Sign out / Sign in */}
            {user ? (
              <DropdownMenuItem
                className="rounded-none px-4 pb-4 pt-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
                onClick={signOut}
              >
                <LogOut size={14} className="mr-2 opacity-60" />
                Sign out
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="rounded-none px-4 pb-4 pt-3 text-[14px] text-white/60 hover:text-white focus:text-white focus:bg-white/[0.06] cursor-pointer"
                onClick={() => setAuthModalOpen(true)}
              >
                <UserIcon size={14} className="mr-2 opacity-60" />
                Sign in
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>

        </DropdownMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
