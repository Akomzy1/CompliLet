import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "CompliLet Internal",
  robots: "noindex, nofollow",
};

const navLinks = [
  { href: "/internal/escalations", label: "Escalations" },
  { href: "/internal/sessions",    label: "Sessions"    },
  { href: "/internal/analytics",   label: "Analytics"   },
];

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Top nav */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-widest text-teal-400 uppercase">
              CompliLet <span className="text-gray-500">/ Internal</span>
            </span>
            <nav className="flex gap-1">
              {navLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded px-3 py-1.5 text-sm text-gray-400 transition hover:bg-gray-800 hover:text-gray-100"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <form action="/internal/logout" method="POST">
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-xs text-gray-500 transition hover:text-gray-300"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
    </div>
  );
}
