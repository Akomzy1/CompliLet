import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ADMIN_EMAILS } from "@/lib/constants";
import { LoginForm } from "./LoginForm";

interface Props {
  searchParams: Promise<{ reason?: string }>;
}

export const metadata = { title: "Sign In" };

export default async function LoginPage({ searchParams }: Props) {
  // Already signed in?
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
    redirect("/internal");
  }

  const { reason } = await searchParams;
  const errorMessage =
    reason === "unauthorized"
      ? "Your account is not authorised to access the admin panel."
      : reason === "unauthenticated"
      ? "Please sign in to continue."
      : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 px-4">
        {/* Logo / Title */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-xl bg-teal-600 mb-4">
            <span className="text-white font-bold text-xl">C</span>
          </div>
          <h1 className="text-2xl font-bold text-white">CompliLet Admin</h1>
          <p className="text-gray-400 text-sm mt-1">Internal dashboard — authorised access only</p>
        </div>

        {/* Error from middleware redirect */}
        {errorMessage && (
          <div className="rounded-lg bg-red-900/40 border border-red-700 px-4 py-3 text-sm text-red-300">
            {errorMessage}
          </div>
        )}

        <LoginForm />
      </div>
    </div>
  );
}
