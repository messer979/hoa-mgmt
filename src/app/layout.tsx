import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HOA Board",
  description: "HOA discussions, votes, and email inbox",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
