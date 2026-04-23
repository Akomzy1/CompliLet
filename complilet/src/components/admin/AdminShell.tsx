"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Users,
  Home,
  Star,
  AlertTriangle,
  MessageSquare,
  FileText,
  DollarSign,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavCounts {
  alerts?: number;
  tenancies?: number;
  screenings?: number;
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: keyof AdminNavCounts;
}

const NAV: NavItem[] = [
  { href: "/admin",              label: "Overview",       icon: LayoutGrid    },
  { href: "/admin/landlords",    label: "Landlords",      icon: Users         },
  { href: "/admin/tenancies",    label: "Tenancies",      icon: Home,            badgeKey: "tenancies"  },
  { href: "/admin/screenings",   label: "Screenings",     icon: Star,            badgeKey: "screenings" },
  { href: "/admin/alerts",       label: "Alerts",         icon: AlertTriangle,   badgeKey: "alerts"     },
  { href: "/admin/conversations",label: "Conversations",  icon: MessageSquare },
  { href: "/admin/documents",    label: "Documents",      icon: FileText      },
  { href: "/admin/billing",      label: "Billing",        icon: DollarSign    },
  { href: "/admin/settings",     label: "Settings",       icon: Settings      },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

interface Props {
  children: React.ReactNode;
  counts?: AdminNavCounts;
  adminName?: string;
  systemStatus?: "operational" | "degraded" | "outage";
}

export function AdminShell({
  children,
  counts = {},
  adminName = "Admin",
  systemStatus = "operational",
}: Props) {
  const pathname = usePathname() ?? "";

  // Login page: render children raw (no chrome)
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const statusConfig = {
    operational: { label: "All systems operational", dot: "bg-admin-teal" },
    degraded:    { label: "Degraded performance",    dot: "bg-amber-400"  },
    outage:      { label: "Outage",                  dot: "bg-red-500"    },
  }[systemStatus];

  return (
    <div className="flex min-h-dvh bg-admin-cream text-admin-ink font-ui">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-[220px] flex-col bg-admin-navy text-admin-nav-text">
        {/* Brand */}
        <div className="border-b border-white/5 px-5 py-5">
          <Link href="/admin" className="block">
            <p className="font-display text-xl font-semibold leading-tight text-white">
              CompliLet
            </p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-admin-nav-active">
              Admin console
            </p>
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon, badgeKey }) => {
              const active = isActive(pathname, href);
              const count = badgeKey ? counts[badgeKey] ?? 0 : 0;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      active
                        ? "bg-[rgba(55,138,221,0.18)] font-semibold text-admin-nav-active"
                        : "text-admin-nav-text hover:bg-admin-navy-soft hover:text-white"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {count > 0 && (
                      <span
                        className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-admin-nav-active/20 text-admin-nav-active"
                            : "bg-white/10 text-admin-nav-text"
                        }`}
                        aria-label={`${count} ${label.toLowerCase()} pending`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-white/5 px-5 py-4">
          <form action="/admin/logout" method="POST">
            <button
              type="submit"
              className="text-xs font-medium text-admin-nav-text transition hover:text-white"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-h-dvh flex-1 flex-col pl-[220px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-admin-line bg-white/80 px-8 py-4 backdrop-blur">
          <p className="text-sm text-admin-mute">{today}</p>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-admin-line bg-white px-3 py-1 text-xs font-medium text-admin-mute">
              <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} aria-hidden />
              {statusConfig.label}
            </span>
            <span className="text-sm font-medium text-admin-ink">{adminName}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
