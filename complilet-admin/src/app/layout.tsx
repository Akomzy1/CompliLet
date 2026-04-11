import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CompliLet Admin", template: "%s | CompliLet Admin" },
  description: "CompliLet internal admin dashboard",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
