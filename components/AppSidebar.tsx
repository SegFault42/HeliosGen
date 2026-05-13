"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";
import {
  Workflow,
  Image as ImageIcon,
  Video as VideoIcon,
  Package,
  MessageSquare,
  User as UserIcon,
  LogOut,
  Settings,
  ChevronUp,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function LogoIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 20 20" fill="#ff3df5" stroke="none">
      <path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z" />
    </svg>
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "images";

  const [user, setUser] = React.useState<User | null>(null);
  const [balance, setBalance] = React.useState<number | null>(null);

  const setAuthModalOpen = useWorkflowStore((s) => s.setAuthModalOpen);
  const setSettingsOpen = useWorkflowStore((s) => s.setSettingsOpen);
  const setShowDashboard = useWorkflowStore((s) => s.setShowDashboard);
  const setKieKeySet = useWorkflowStore((s) => s.setKieKeySet);
  const supabase = createClient();

  // ── Auth ──────────────────────────────────────────────────────────────────
  React.useEffect(() => {
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
  }, [supabase, setKieKeySet]);

  // ── Credits ───────────────────────────────────────────────────────────────
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
    return () => {
      clearInterval(id);
      window.removeEventListener("credits-refresh", fetchBalance);
    };
  }, [supabase]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const navItems = [
    {
      label: "Workflow",
      href: "/",
      icon: Workflow,
      active: pathname === "/",
      onClick: () => setShowDashboard(true),
    },
    {
      label: "Image",
      href: "/gallery?tab=images",
      icon: ImageIcon,
      active: pathname === "/gallery" && tab === "images",
      onClick: () => setShowDashboard(false),
    },
    {
      label: "Video",
      href: "/gallery?tab=videos",
      icon: VideoIcon,
      active: pathname === "/gallery" && tab === "videos",
      onClick: () => setShowDashboard(false),
    },
    {
      label: "Assets",
      href: "#",
      icon: Package,
      active: false,
      disabled: true,
    },
    {
      label: "Chat",
      href: "#",
      icon: MessageSquare,
      active: false,
      disabled: true,
    },
  ];

  return (
    <Sidebar collapsible="icon" className="border-r border-white/5 bg-[#0A0C0E] relative">
      <SidebarHeader className="h-16 flex items-center px-4 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <div className="flex items-center gap-3">
          <LogoIcon />
          <span className="font-semibold text-white tracking-tight group-data-[collapsible=icon]:hidden">
            HeliosGen
          </span>
        </div>
      </SidebarHeader>

      <SidebarTrigger className="absolute right-2 top-4 text-white/40 hover:text-white hover:bg-white/5 z-50 group-data-[state=collapsed]:hidden transition-all duration-200" />

      <SidebarContent className="px-3 py-4 gap-1">
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.label} className="group-data-[collapsible=icon]:px-0 px-2">
              <SidebarMenuButton
                asChild
                isActive={item.active}
                disabled={item.disabled}
                tooltip={item.label}
                className={cn(
                  "h-9 px-3 rounded-lg transition-colors hover:bg-white/5 active:bg-white/10 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center",
                  item.active && "bg-white/8 text-white",
                  !item.active && "text-white/50",
                  item.disabled && "opacity-50 cursor-not-allowed pointer-events-none"
                )}
              >
                <Link
                  href={item.href}
                  onClick={item.onClick}
                  className="flex items-center gap-3 w-full group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                >
                  <item.icon size={18} className="shrink-0" />
                  <span className="group-data-[collapsible=icon]:hidden font-medium text-sm">
                    {item.label}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-3 gap-3">
        <div className="mx-2 flex items-center justify-between px-3 py-2.5 bg-gradient-to-tr from-white/[0.02] to-transparent border border-white/[0.04] rounded-lg group-data-[collapsible=icon]:hidden">
          <span className="text-[11px] text-white/40 font-medium tracking-wide">Credits</span>
          <div className="flex items-center gap-2">
            <div className="size-1.5 rounded-full bg-[#ff3df5] shadow-[0_0_8px_rgba(255,61,245,0.6)]" />
            <span className="text-xs font-mono font-medium text-white/80">
              {balance !== null ? balance.toLocaleString() : "—"}
            </span>
          </div>
        </div>

        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="h-12 px-2 rounded-xl data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                  >
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage src={user?.user_metadata?.avatar_url} />
                      <AvatarFallback className="rounded-lg bg-[#141618] text-[#ff3df5]">
                        <UserIcon className="size-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                      <span className="truncate font-semibold text-white/90">
                        {user ? (user.user_metadata?.full_name || user.email?.split("@")[0]) : "Guest User"}
                      </span>
                      <span className="truncate text-xs text-white/40">
                        {user ? user.email : "Sign in to your account"}
                      </span>
                    </div>
                    <ChevronUp className="ml-auto size-4 group-data-[collapsible=icon]:hidden text-white/40" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent
                className="w-[--radix-menu-content-width] min-w-56 mb-2"
                side="top"
                align="end"
                sideOffset={4}
              >
                {user && (
                  <>
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarImage src={user?.user_metadata?.avatar_url} />
                        <AvatarFallback className="rounded-lg bg-[#141618] text-[#ff3df5]">
                          <UserIcon className="size-5" />
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-semibold">
                          {user.user_metadata?.full_name || user.email?.split("@")[0]}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                      </div>
                    </div>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="size-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {user ? (
                  <DropdownMenuItem
                    className="gap-2 text-red-400 focus:text-red-400 cursor-pointer"
                    onClick={signOut}
                  >
                    <LogOut className="size-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    className="gap-2 cursor-pointer"
                    onClick={() => setAuthModalOpen(true)}
                  >
                    <UserIcon className="size-4" />
                    <span>Sign in</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
