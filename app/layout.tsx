import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casa Rebecca BIM Streamer",
  description: "A ThatOpen BIM fragment streaming demo.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
