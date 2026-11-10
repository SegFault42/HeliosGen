import type { Metadata, Viewport } from "next";
import { Outfit, Archivo, Space_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/AppSidebar";
import GlobalModals from "@/components/GlobalModals";
import KieBanner from "@/components/KieBanner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cookies } from "next/headers";
import { DragDropGuard } from "@/components/DragDropGuard";

// Solstice type roles (design/tokens.css): Outfit = UI, Archivo (wdth 75 / 900) = display, Space Mono = metadata.
// Self-hosted through next/font so the desktop build works offline.
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
});

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "ANVIL",
  description: "Build AI image & video generation workflows visually",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <html
      lang="en"
      className={`${outfit.variable} ${archivo.variable} ${spaceMono.variable} antialiased dark`}
      style={{ height: "100%" }}
    >
      <body className="bg-bg-0 text-text-1 h-full overflow-hidden">
        <TooltipProvider>
          <SidebarProvider defaultOpen={sidebarOpen} className="h-full">
            <AppSidebar />
            <SidebarInset style={{ backgroundColor: "transparent" }} className="flex flex-col min-h-0 min-w-0 border border-border-1 bg-bg-1 my-3 mr-3 rounded-[20px] overflow-hidden">
              <KieBanner />
              <div className="md:hidden flex items-center h-10 px-3 border-b border-border-1 shrink-0">
                <SidebarTrigger className="text-text-2 hover:text-text-1 hover:bg-bg-2 transition-colors rounded-full p-1.5 [&_svg]:size-4" />
              </div>
              <DragDropGuard />
        {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <GlobalModals />
      </body>
    </html>
  );
}
