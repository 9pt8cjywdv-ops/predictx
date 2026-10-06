import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "B-BBEE Verify", template: "%s · B-BBEE Verify" },
  description: "AI-assisted B-BBEE verification management",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
