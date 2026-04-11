"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import {
  WhatsAppMockup,
  type WhatsAppMessage,
} from "@/components/whatsapp/WhatsAppMockup";
import { COMPANY } from "@/lib/constants";

// ─── Animation ────────────────────────────────────────────────────────────────

type Bezier = [number, number, number, number];
const EASE_OUT: Bezier = [0.25, 0.46, 0.45, 0.94];

function inView(delay = 0) {
  return {
    initial: { opacity: 0, y: 32 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "-80px" } as const,
    transition: { duration: 0.55, ease: EASE_OUT, delay },
  };
}

// ─── Per-step WhatsApp conversation data ──────────────────────────────────────

const CONV_1: WhatsAppMessage[] = [
  {
    id: "1-1",
    direction: "out",
    text: `Hi, a tenant just enquired about 14 Park Road:\n\n"Hi, I'm interested in the 2-bed flat — could we arrange a viewing?"\n\nCould you handle the screening?`,
    time: "09:14",
    status: "read",
  },
  {
    id: "1-2",
    direction: "in",
    text: "On it! 👍 I'll reach out to them now and run a full pre-screening. I'll send you a report once it's complete.",
    time: "09:14",
  },
];

const CONV_2: WhatsAppMessage[] = [
  {
    id: "2-1",
    direction: "in",
    text: "Hi! I'm the AI assistant managing the tenancy for 14 Park Road. Could I ask you a few quick questions to get things moving?",
    time: "09:20",
  },
  {
    id: "2-2",
    direction: "out",
    text: "Yes, of course!",
    time: "09:21",
    status: "read",
  },
  {
    id: "2-3",
    direction: "in",
    text: "Great 😊 What's your approximate monthly take-home income? The rent is £1,200/month.",
    time: "09:21",
  },
  {
    id: "2-4",
    direction: "out",
    text: "Around £2,400/month. I can provide payslips.",
    time: "09:22",
    status: "read",
  },
];

const CONV_3: WhatsAppMessage[] = [
  {
    id: "3-1",
    direction: "in",
    text: "Could you send a clear photo of your passport or driving licence? 📷",
    time: "10:05",
  },
  {
    id: "3-2",
    direction: "out",
    text: "📎 passport_photo.jpg",
    time: "10:07",
    status: "read",
  },
  {
    id: "3-3",
    direction: "in",
    text: "✅ Identity verified — name and expiry date confirmed.\n\nCould you now send a recent payslip or 3-month bank statement?",
    time: "10:08",
  },
];

const CONV_4: WhatsAppMessage[] = [
  {
    id: "4-1",
    direction: "out",
    text: "Hi, I'm CompliLet AI reaching out regarding a tenancy application. Could you confirm that James Carter rented from you at 7 Maple Close?",
    time: "11:30",
    status: "read",
  },
  {
    id: "4-2",
    direction: "in",
    text: "Yes, he rented from us 2021–2024. Always paid on time, no damage or complaints.",
    time: "11:47",
  },
  {
    id: "4-3",
    direction: "out",
    text: "Thank you! One last question — would you re-rent to James?",
    time: "11:48",
    status: "delivered",
  },
];

const CONV_5: WhatsAppMessage[] = [
  {
    id: "5-1",
    direction: "in",
    text: "Your screening report for James Carter is ready 📋\n\n📊 Score: 8/10 — Recommended ✅\n💰 Income ratio: 2.67× rent\n🪪 Right to Rent: Verified\n📞 Landlord ref: Positive\n\nFull PDF sent to your email.",
    time: "14:22",
  },
  {
    id: "5-2",
    direction: "out",
    text: "Perfect. How do I proceed with the offer?",
    time: "14:24",
    status: "read",
  },
  {
    id: "5-3",
    direction: "in",
    text: "I can send James the tenancy agreement and move-in pack directly on WhatsApp. Just confirm and I'll handle it.",
    time: "14:24",
  },
];

const CONV_6: WhatsAppMessage[] = [
  {
    id: "6-1",
    direction: "in",
    text: "⚠️ Gas safety certificate for 14 Park Road expires in 30 days. A lapse could mean a £6,000 fine.",
    time: "08:00",
  },
  {
    id: "6-2",
    direction: "out",
    text: "Thanks — can you find me an engineer?",
    time: "08:04",
    status: "read",
  },
  {
    id: "6-3",
    direction: "in",
    text: "Found 3 Gas Safe engineers available this week, all within 2 miles. Want me to send them the job details?",
    time: "08:04",
  },
];

// ─── Step definitions ─────────────────────────────────────────────────────────

interface Step {
  number: number;
  title: string;
  description: string;
  conversation: WhatsAppMessage[];
  contactName: string;
  contactAvatar: string;
}

const STEPS: Step[] = [
  {
    number: 1,
    title: "Forward the Enquiry",
    description:
      "A tenant contacts you on OpenRent, SpareRoom, or Facebook. Instead of handling it yourself, just forward their message to CompliLet's WhatsApp number. That's it — we take it from there.",
    conversation: CONV_1,
    contactName: "CompliLet AI",
    contactAvatar: "C",
  },
  {
    number: 2,
    title: "We Chat with the Tenant",
    description:
      "CompliLet introduces itself and asks friendly screening questions: name, employment, income, move-in date, pets, smoking status. The tenant just replies normally — no forms, no portals.",
    conversation: CONV_2,
    contactName: "CompliLet AI",
    contactAvatar: "C",
  },
  {
    number: 3,
    title: "Documents Get Verified",
    description:
      "We ask the tenant to photograph their ID, payslip, and proof of address. Our AI checks every document: name matching, expiry dates, and authenticity flags. GDPR-compliant and encrypted.",
    conversation: CONV_3,
    contactName: "CompliLet AI",
    contactAvatar: "C",
  },
  {
    number: 4,
    title: "References Get Chased",
    description:
      "We contact the tenant's previous landlord and employer on WhatsApp. If they don't reply, we follow up automatically at 2, 4, and 7 days — so you never have to chase anyone.",
    conversation: CONV_4,
    contactName: "Previous Landlord",
    contactAvatar: "L",
  },
  {
    number: 5,
    title: "You Get a Decision Pack",
    description:
      "Everything arrives in one WhatsApp message: screening score, verified documents, Right to Rent certificate, and reference summaries. One tap to accept or decline the tenant.",
    conversation: CONV_5,
    contactName: "CompliLet AI",
    contactAvatar: "C",
  },
  {
    number: 6,
    title: "CompliLet Stays Active",
    description:
      "After move-in: rent reminders, gas safety alerts, maintenance triage, and quarterly inspections. Your entire property management lifecycle runs inside one WhatsApp thread.",
    conversation: CONV_6,
    contactName: "CompliLet AI",
    contactAvatar: "C",
  },
];

// ─── Step block — text side ───────────────────────────────────────────────────

function StepText({
  step,
  delay,
}: {
  step: Step;
  delay: number;
}) {
  return (
    <motion.div
      {...inView(delay)}
      className="flex flex-col"
    >
      {/* Step circle */}
      <div
        className={[
          "w-12 h-12 rounded-full shrink-0 mb-5",
          "flex items-center justify-center",
          "font-display font-bold text-xl text-white",
          "bg-teal shadow-trust",
        ].join(" ")}
        aria-label={`Step ${step.number}`}
      >
        {step.number}
      </div>

      <h3 className="font-display font-bold text-2xl sm:text-[26px] text-navy leading-tight mb-3">
        {step.title}
      </h3>
      <p className="font-body text-base leading-relaxed text-dark-text/80 max-w-md">
        {step.description}
      </p>
    </motion.div>
  );
}

// ─── Step block — mockup side ─────────────────────────────────────────────────

function StepMockup({ step, delay }: { step: Step; delay: number }) {
  return (
    <motion.div
      {...inView(delay)}
      className="flex justify-center items-center"
    >
      <WhatsAppMockup
        messages={step.conversation}
        animated
        contactName={step.contactName}
        contactAvatar={step.contactAvatar}
      />
    </motion.div>
  );
}

// ─── Connector chevron between steps (desktop only) ───────────────────────────

function StepConnector() {
  return (
    <div
      aria-hidden="true"
      className="hidden lg:flex justify-center items-center py-2"
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        className="text-teal-light"
      >
        <polyline
          points="6 9 12 15 18 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="hiw-heading"
      className="bg-cream"
    >
      {/* ── Section header ──────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-20 lg:pt-24 pb-4">
        <motion.div {...inView(0)} className="text-center">
          <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal mb-3">
            The process
          </p>
          <h2
            id="hiw-heading"
            className="font-display font-bold text-3xl sm:text-4xl lg:text-5xl text-navy leading-tight tracking-[-0.02em]"
          >
            How CompliLet Works
          </h2>
          <p className="mt-4 font-body text-lg text-muted-gray max-w-xl mx-auto leading-relaxed">
            From enquiry to move-in, everything happens inside WhatsApp.
          </p>
        </motion.div>
      </div>

      {/* ── Steps ───────────────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
        <div className="flex flex-col gap-0">
          {STEPS.map((step, index) => {
            const isEven = index % 2 === 0; // even = text left, mockup right
            // Stagger delays: each step pair adds 0.1s
            const textDelay = 0;
            const mockupDelay = 0.12;

            return (
              <div key={step.number}>
                {/* ── Step row ─────────────────────────────────────────── */}
                <div
                  className={[
                    // Mobile: single column
                    "flex flex-col gap-10",
                    // Desktop: two columns, alternating order
                    isEven
                      ? "lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center"
                      : "lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center",
                    "py-10 lg:py-14",
                    // Alternating row tint for readability on the cream bg
                    !isEven ? "lg:bg-teal-light/20 lg:rounded-2xl lg:px-8" : "",
                  ].join(" ")}
                >
                  {isEven ? (
                    // Text LEFT, Mockup RIGHT
                    <>
                      <StepText step={step} delay={textDelay} />
                      <StepMockup step={step} delay={mockupDelay} />
                    </>
                  ) : (
                    // On mobile: still text-first (DOM order = text then mockup)
                    // On desktop: mockup LEFT, text RIGHT (via CSS order)
                    <>
                      <div className="order-2 lg:order-1">
                        <StepMockup step={step} delay={mockupDelay} />
                      </div>
                      <div className="order-1 lg:order-2">
                        <StepText step={step} delay={textDelay} />
                      </div>
                    </>
                  )}
                </div>

                {/* ── Connector between steps (not after last) ──────────── */}
                {index < STEPS.length - 1 && <StepConnector />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Bottom CTA ──────────────────────────────────────────────────── */}
      <div className="border-t border-teal-light">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-16 lg:py-20">
          <motion.div
            {...inView(0)}
            className="flex flex-col items-center text-center gap-6"
          >
            <p className="font-body font-semibold text-sm tracking-widest uppercase text-teal">
              See it for yourself
            </p>
            <h2 className="font-display font-bold text-3xl sm:text-4xl text-navy leading-tight tracking-[-0.02em]">
              Ready to try it?
            </h2>
            <p className="font-body text-lg text-muted-gray max-w-md leading-relaxed">
              Start your first tenant screening in under 60 seconds — no
              account needed, just WhatsApp.
            </p>
            <Button
              variant="whatsapp"
              href={COMPANY.whatsappLink}
              size="lg"
              external
              aria-label="Start using CompliLet on WhatsApp"
            >
              Start on WhatsApp →
            </Button>
            <p className="font-body text-sm text-muted-gray">
              First screening from{" "}
              <span className="font-semibold text-navy">£4.99</span> · No
              subscription required
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
