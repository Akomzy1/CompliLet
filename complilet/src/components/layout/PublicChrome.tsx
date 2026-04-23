"use client";

import { usePathname } from "next/navigation";

/**
 * Renders its children only on public (marketing) routes. The admin console
 * has its own layout chrome — we don't want the landing Header/Footer
 * leaking into /admin/*.
 */
export function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/admin") || pathname.startsWith("/internal")) {
    return null;
  }
  return <>{children}</>;
}
