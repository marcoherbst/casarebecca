import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marco",
  description: "A simple page with Marco's name.",
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
