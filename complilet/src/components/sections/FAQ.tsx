"use client";

import { motion } from "framer-motion";
import { FAQGroup } from "@/components/ui/FAQItem";
import { FAQS } from "@/lib/faq-data";

// ─── Animation ────────────────────────────────────────────────────────────────

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

// ─── Component ────────────────────────────────────────────────────────────────

export function FAQ() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-heading"
      className="bg-white"
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-20 lg:py-24">

        {/* ── Header ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.55, ease: EASE_OUT }}
          className="text-center mb-12"
        >
          <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal mb-3">
            Got questions?
          </p>
          <h2
            id="faq-heading"
            className="font-display font-bold text-3xl sm:text-4xl text-navy leading-tight tracking-[-0.02em]"
          >
            Frequently Asked Questions
          </h2>
          <p className="mt-4 font-body text-muted-gray leading-relaxed">
            Everything landlords ask before their first screening.
          </p>
        </motion.div>

        {/* ── Accordion ─────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.15 }}
        >
          <FAQGroup
            items={FAQS.map((f) => ({
              id: f.id,
              question: f.question,
              answer: f.answer,
            }))}
            variant="light"
            allowMultiple={false}
          />
        </motion.div>

        {/* ── Still have questions nudge ─────────────────────────────────── */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, delay: 0.3 }}
          className="mt-10 text-center font-body text-sm text-muted-gray"
        >
          Still have a question?{" "}
          <a
            href="https://wa.me/447700000000?text=Hi%2C%20I%20have%20a%20question%20about%20CompliLet"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-teal underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            Message us on WhatsApp
          </a>{" "}
          — we reply within 2 hours.
        </motion.p>
      </div>
    </section>
  );
}
