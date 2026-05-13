import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import NavigationSidebar from "@/components/NavigationSidebar";
import GlobalModals from "@/components/GlobalModals";

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
      <body style={{ height: "100%", background: "#1A1A1C", color: "#fff", display: "flex", flexDirection: "row", overflow: "hidden" }}>
        <NavigationSidebar />
        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {children}
        </main>
        <GlobalModals />
      </body>
    </html>
  );
}
