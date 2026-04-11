import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ADMIN_EMAILS } from "@/lib/constants";
import { SignOutButton } from "@/components/ui/SignOutButton";

// ─── Nav items ────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { href: "/internal", label: "Dashboard", icon: "⊞" },
  { href: "/internal/landlords", label: "Landlords", icon: "👤" },
  { href: "/internal/screenings", label: "Screenings", icon: "🔍" },
  { href: "/internal/tenancies", label: "Tenancies", icon: "🏠" },
  { href: "/internal/escalations", label: "Escalations", icon: "⚡" },
  { href: "/internal/revenue", label: "Revenue", icon: "💷" },
  { href: "/internal/agents", label: "AI Agents", icon: "🤖" },
  { href: "/internal/system", label: "System", icon: "⚙️" },
];

export default async function InternalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auth guard — middleware handles redirects but double-check here
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">CompliLet</p>
              <p className="text-gray-500 text-xs">Admin</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon} label={item.label} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800">
          <p className="text-gray-500 text-xs mb-2 truncate">{user.email}</p>
          <SignOutButton />
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

// ─── NavLink — uses pathname matching via CSS hack (no client state needed) ───
// We use a URL-based active indicator: the page itself can set a data attribute,
// but for simplicity we use a simple link with subtle active styling via group.
function NavLink({ href, icon, label }: { href: string; icon: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors group"
    >
      <span className="text-base leading-none">{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
