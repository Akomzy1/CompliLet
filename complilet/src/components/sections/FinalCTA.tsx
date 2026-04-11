"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { COMPANY } from "@/lib/constants";

// Reuse the same radial + dot pattern from the hero — brand consistency
const BG: React.CSSProperties = {
  background: "#0F2B46",
  backgroundImage: [
    "radial-gradient(ellipse 80% 55% at 50% -5%, rgba(13,148,136,0.20) 0%, transparent 65%)",
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Ccircle cx='18' cy='18' r='1.2' fill='%23ffffff' fill-opacity='0.04'/%3E%3C/svg%3E\")",
  ].join(", "),
};

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

export function FinalCTA() {
  return (
    <section
      id="cta"
      aria-labelledby="final-cta-heading"
      style={BG}
      className="overflow-hidden"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-24 lg:py-28 flex flex-col items-center text-center gap-6">

        {/* Eyebrow */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.45, ease: EASE_OUT }}
          className="font-body font-semibold text-sm tracking-widest uppercase text-teal"
        >
          Get started today
        </motion.p>

        {/* Heading */}
        <motion.h2
          id="final-cta-heading"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, ease: EASE_OUT, delay: 0.1 }}
          className="font-display font-bold text-white leading-tight tracking-[-0.02em] text-3xl sm:text-4xl lg:text-[52px]"
        >
          Ready to Screen Your<br className="hidden sm:block" /> Next Tenant?
        </motion.h2>

        {/* Subheading */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.22 }}
          className="font-body text-lg sm:text-xl leading-relaxed max-w-md"
          style={{ color: "rgba(253,248,240,0.82)" }}
        >
          It takes 5 minutes to set up. No app. No dashboard.
          Just WhatsApp.
        </motion.p>

        {/* CTA button */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.34 }}
          className="flex flex-col items-center gap-3"
        >
          <Button
            variant="whatsapp"
            href={COMPANY.whatsappLink}
            size="lg"
            external
            aria-label="Start using CompliLet on WhatsApp"
          >
            Start on WhatsApp →
          </Button>

          <p
            className="font-body text-sm"
            style={{ color: "rgba(224,245,243,0.6)" }}
          >
            Free for your first 3 screenings · No credit card needed
          </p>
        </motion.div>

        {/* Decorative teal rule */}
        <motion.div
          initial={{ scaleX: 0 }}
          whileInView={{ scaleX: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.5 }}
          className="w-16 h-px mt-2"
          style={{ background: "rgba(13,148,136,0.5)", transformOrigin: "center" }}
          aria-hidden="true"
        />
      </div>
    </section>
  );
}
