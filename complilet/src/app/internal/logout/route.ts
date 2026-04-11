import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/middleware";

export async function POST() {
  const res = NextResponse.redirect(new URL("/internal/login", process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"));
  res.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
