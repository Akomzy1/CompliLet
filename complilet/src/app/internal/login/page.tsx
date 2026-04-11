import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, COOKIE_MAX_AGE } from "@/middleware";

async function loginAction(formData: FormData) {
  "use server";
  const password = formData.get("password") as string;
  const from = (formData.get("from") as string) || "/internal/escalations";
  const expected = process.env.INTERNAL_DASHBOARD_PASSWORD ?? "";

  if (!expected) {
    throw new Error("INTERNAL_DASHBOARD_PASSWORD is not set");
  }

  if (password !== expected) {
    redirect(`/internal/login?error=1&from=${encodeURIComponent(from)}`);
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
  const from = params.from ?? "/internal/escalations";
  const hasError = !!params.error;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-xl">
        <div className="mb-8 text-center">
          <p className="mt-1 text-xs font-semibold tracking-widest text-teal-400 uppercase">
            CompliLet Internal
          </p>
          <h1 className="mt-3 text-xl font-semibold text-gray-100">Sign in</h1>
        </div>

        <form action={loginAction}>
          <input type="hidden" name="from" value={from} />

          <div className="mb-4">
            <label htmlFor="password" className="mb-1.5 block text-sm text-gray-400">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none ring-teal-500 transition focus:border-teal-500 focus:ring-1"
              placeholder="Enter dashboard password"
            />
          </div>

          {hasError && (
            <p className="mb-4 rounded-lg bg-red-950/50 px-3 py-2 text-sm text-red-400">
              Incorrect password. Try again.
            </p>
          )}

          <button
            type="submit"
            className="mt-2 w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-500 active:scale-[0.98]"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
