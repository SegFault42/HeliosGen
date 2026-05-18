import type { Metadata } from "next";
import { Geist, Geist_Mono, Doto } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/AppSidebar";
import GlobalModals from "@/components/GlobalModals";
import KieBanner from "@/components/KieBanner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cookies } from "next/headers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const doto = Doto({
  variable: "--font-doto",
  subsets: ["latin"],
  weight: ["900"],
});

export const metadata: Metadata = {
  title: "HeliosGen",
  description: "Build AI image & video generation workflows visually",
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
      className={`${geistSans.variable} ${geistMono.variable} ${doto.variable} antialiased dark`}
      style={{ height: "100%" }}
    >
      <body className="bg-black text-white h-full overflow-hidden">
        <TooltipProvider>
          <SidebarProvider defaultOpen={sidebarOpen} className="h-full">
            <AppSidebar />
            <SidebarInset style={{ backgroundColor: "transparent" }} className="flex flex-col min-h-0 min-w-0 border-l border-r border-t border-white/[0.08] mx-2 mt-2 rounded-tl-xl rounded-tr-xl overflow-hidden">
              <KieBanner />
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <GlobalModals />
      </body>
    </html>
  );
}
