import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, COOKIE_MAX_AGE } from "@/proxy";

async function loginAction(formData: FormData) {
  "use server";
  const password = formData.get("password") as string;
  const from = (formData.get("from") as string) || "/admin";
  const expected = process.env.INTERNAL_DASHBOARD_PASSWORD ?? "";

  if (!expected) {
    throw new Error("INTERNAL_DASHBOARD_PASSWORD is not set");
  }

  if (password !== expected) {
    redirect(`/admin/login?error=1&from=${encodeURIComponent(from)}`);
  }

  const store = await cookies();
  store.set(COOKIE_NAME, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  redirect(from);
}

interface Props {
  searchParams: Promise<{ error?: string; from?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const from = params.from ?? "/admin";
  const hasError = !!params.error;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-admin-navy font-ui">
      <div className="w-full max-w-sm rounded-2xl border border-admin-navy-soft bg-[#0E2747] p-8 shadow-trust">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-admin-nav-active">
            CompliLet
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-white">
            Admin console
          </h1>
          <p className="mt-1 text-sm text-admin-nav-text">
            Sign in to continue
          </p>
        </div>

        <form action={loginAction}>
          <input type="hidden" name="from" value={from} />

          <div className="mb-4">
            <label
              htmlFor="password"
              className="mb-1.5 block text-sm font-medium text-admin-nav-text"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-admin-navy-soft bg-admin-navy px-3 py-2.5 text-sm text-white placeholder-admin-mute outline-none transition focus:border-admin-nav-active focus:ring-2 focus:ring-admin-nav-active/40"
              placeholder="Enter dashboard password"
            />
          </div>

          {hasError && (
            <p
              role="alert"
              className="mb-4 rounded-lg bg-red-950/60 px-3 py-2 text-sm text-red-300"
            >
              Incorrect password. Try again.
            </p>
          )}

          <button
            type="submit"
            className="mt-2 w-full rounded-lg bg-admin-teal px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0C5C48] active:scale-[0.98]"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
