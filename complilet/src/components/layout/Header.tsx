"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { COMPANY } from "@/lib/constants";

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { label: "How It Works",           href: "/#how-it-works" },
  { label: "Features",               href: "/#features" },
  { label: "Pricing",                href: "/#pricing" },
  { label: "For Overseas Landlords", href: "/#overseas" },
  { label: "Blog",                   href: "/blog" },
] as const;

// ─── Logo ─────────────────────────────────────────────────────────────────────

function Logo({ scrolled }: { scrolled: boolean }) {
  return (
    <Link
      href="/"
      className="inline-flex items-baseline shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal rounded-sm"
      aria-label="CompliLet — home"
    >
      <span
        className={[
          "font-display font-bold text-xl leading-none transition-colors duration-300",
          scrolled ? "text-navy" : "text-white",
        ].join(" ")}
      >
        Compli<span className="text-teal">Let</span>
      </span>
      {/* Teal dot — sits at the tail of the final "t" */}
      <span
        className="w-1.5 h-1.5 rounded-full bg-teal shrink-0 -ml-px"
        aria-hidden="true"
      />
    </Link>
  );
}

// ─── WhatsApp icon (used in CTA button) ──────────────────────────────────────

function WAIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ─── Hamburger / Close icon ───────────────────────────────────────────────────

function HamburgerIcon({ open, scrolled }: { open: boolean; scrolled: boolean }) {
  const color = scrolled || open ? "#0F2B46" : "#FFFFFF";
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
      className="transition-all duration-200"
    >
      {/* Top bar — morphs to first diagonal */}
      <line
        x1="2" y1={open ? "11" : "5"}  x2="20" y2={open ? "11" : "5"}
        stroke={color} strokeWidth="2" strokeLinecap="round"
        style={{ transform: open ? "rotate(45deg)" : "none", transformOrigin: "11px 11px", transition: "all 0.22s ease" }}
      />
      {/* Middle bar — fades out */}
      <line
        x1="2" y1="11" x2="20" y2="11"
        stroke={color} strokeWidth="2" strokeLinecap="round"
        style={{ opacity: open ? 0 : 1, transition: "opacity 0.15s ease" }}
      />
      {/* Bottom bar — morphs to second diagonal */}
      <line
        x1="2" y1={open ? "11" : "17"} x2="20" y2={open ? "11" : "17"}
        stroke={color} strokeWidth="2" strokeLinecap="round"
        style={{ transform: open ? "rotate(-45deg)" : "none", transformOrigin: "11px 11px", transition: "all 0.22s ease" }}
      />
    </svg>
  );
}

// ─── Mobile drawer ────────────────────────────────────────────────────────────

function MobileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-40 bg-navy/60 backdrop-blur-sm lg:hidden"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer panel — slides down from header */}
          <motion.div
            key="drawer-panel"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className={[
              "fixed top-[64px] left-0 right-0 z-50 lg:hidden",
              "bg-white shadow-trust",
              "border-b border-teal-light",
              "px-4 pt-4 pb-6",
            ].join(" ")}
            role="dialog"
            aria-label="Navigation menu"
            aria-modal="true"
          >
            <nav aria-label="Mobile navigation">
              <ul className="flex flex-col gap-1" role="list">
                {NAV_ITEMS.map((item, i) => (
                  <motion.li
                    key={item.label}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.22 }}
                  >
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={[
                        "block px-3 py-3 rounded-xl",
                        "font-body font-medium text-navy text-base",
                        "hover:bg-teal-light hover:text-teal",
                        "transition-colors duration-150",
                        "focus-visible:outline-2 focus-visible:outline-teal",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  </motion.li>
                ))}
              </ul>

              {/* Mobile CTA */}
              <div className="mt-4 pt-4 border-t border-teal-light">
                <a
                  href={COMPANY.whatsappLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className={[
                    "flex items-center justify-center gap-2",
                    "w-full py-3 px-6 rounded-full",
                    "bg-whatsapp-green text-white",
                    "font-body font-semibold text-base",
                    "hover:brightness-105 transition-all duration-150 shadow-card",
                  ].join(" ")}
                  aria-label="Start using CompliLet on WhatsApp"
                >
                  <WAIcon />
                  Start on WhatsApp
                </a>
              </div>
            </nav>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Detect scroll position — threshold 60px gives a little breathing room
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    // Run once on mount in case page loads mid-scroll (e.g. refresh with anchor)
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close drawer on route change (next.js soft navigation) or Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header
        className={[
          "fixed top-0 left-0 right-0 z-50",
          "transition-all duration-300",
          scrolled
            ? "bg-white/95 backdrop-blur-md shadow-[0_1px_0_0_rgba(224,245,243,1),0_4px_16px_rgba(15,43,70,0.08)]"
            : "bg-transparent backdrop-blur-0",
        ].join(" ")}
        role="banner"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-16 flex items-center justify-between gap-6">

            {/* ── Logo ──────────────────────────────────────────────── */}
            <Logo scrolled={scrolled} />

            {/* ── Desktop nav ───────────────────────────────────────── */}
            <nav
              className="hidden lg:flex items-center gap-0.5"
              aria-label="Main navigation"
            >
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={[
                    "px-3.5 py-2 rounded-lg",
                    "font-body font-medium text-sm",
                    "transition-colors duration-150",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
                    scrolled
                      ? "text-dark-text/80 hover:text-teal hover:bg-teal-light/60"
                      : "text-white/85 hover:text-white hover:bg-white/10",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* ── Desktop CTA ───────────────────────────────────────── */}
            <a
              href={COMPANY.whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className={[
                "hidden lg:inline-flex items-center gap-2 shrink-0",
                "bg-whatsapp-green text-white",
                "font-body font-semibold text-sm",
                "px-5 py-2.5 rounded-full min-h-[44px]",
                "hover:brightness-105 transition-all duration-150 shadow-card",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
              ].join(" ")}
              aria-label="Start using CompliLet on WhatsApp"
            >
              <WAIcon />
              Start on WhatsApp
            </a>

            {/* ── Mobile hamburger ──────────────────────────────────── */}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              className={[
                "lg:hidden w-10 h-10 flex items-center justify-center rounded-lg",
                "transition-colors duration-150",
                scrolled || menuOpen ? "hover:bg-teal-light" : "hover:bg-white/15",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal",
              ].join(" ")}
            >
              <HamburgerIcon open={menuOpen} scrolled={scrolled} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer rendered outside the header for correct stacking */}
      <div id="mobile-nav">
        <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
      </div>
    </>
  );
}
