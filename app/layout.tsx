import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppSidebar } from "@/components/AppSidebar";
import GlobalModals from "@/components/GlobalModals";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HeliosGen",
  description: "Build AI image & video generation workflows visually",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased dark`}
      style={{ height: "100%" }}
    >
      <body className="bg-[#1A1A1C] text-white h-full overflow-hidden">
        <TooltipProvider>
          <SidebarProvider className="h-full">
            <AppSidebar />
            <SidebarInset className="bg-transparent flex flex-col min-h-0 min-w-0">
              {children}
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
        <GlobalModals />
      </body>
    </html>
  );
}
