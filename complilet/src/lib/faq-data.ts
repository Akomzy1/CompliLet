/**
 * FAQ data — shared between the FAQ section component (client) and the
 * FAQSchema component (server). Keeping it here (no "use client") means
 * both can import it without crossing the Server/Client boundary.
 */

export const FAQS = [
  {
    id: "how-screening-works",
    question: "How does CompliLet screen tenants?",
    answer:
      "CompliLet screens tenants entirely through WhatsApp — no app or dashboard required. When a landlord forwards a tenant enquiry, CompliLet's AI contacts the tenant directly, collects pre-qualification information (income, employment, move-in date), verifies documents (ID, payslip, proof of address), chases references autonomously, and delivers a scored screening report within 24 hours. The landlord receives everything in one WhatsApp message.",
  },
  {
    id: "is-letting-agent",
    question: "Is CompliLet a letting agent?",
    answer:
      "No — CompliLet is an AI-powered property management tool for self-managing landlords, not a letting agent. Letting agents typically charge 10–15% of monthly rent (£150–£300/month on an average UK property). CompliLet provides the same screening, compliance, and tenancy management services from £4.99 per screening. Landlords retain full control of every decision; CompliLet handles the administration.",
  },
  {
    id: "what-documents-checked",
    question: "What documents does CompliLet check?",
    answer:
      "All plans include AI-powered document verification with fraud detection — ID, payslips, and proof of address are checked using Claude vision. Landlord Pro and above include Konfir income verification, which verifies employment and income directly from HMRC, payroll systems, and bank records — eliminating payslip photos entirely. Tenants consent via a 30-second SMS link with no documents to upload. Konfir is UK Government DIATF certified, ICO registered, and part of Experian. All plans also include Home Office document and share code checks for Right to Rent compliance.",
  },
  {
    id: "right-to-rent-legally-valid",
    question: "Is the Right to Rent check legally valid?",
    answer:
      "CompliLet's Right to Rent check produces a timestamped compliance certificate that meets the UK Home Office's requirement for landlords to verify a tenant's right to rent before a tenancy begins. The check uses Home Office document classification criteria and generates an audit-trail-ready PDF. Landlords remain the responsible party under the Immigration Act 2014 and should retain records for the tenancy term plus 12 months.",
  },
  {
    id: "reference-chasing",
    question: "How does reference chasing work?",
    answer:
      "CompliLet contacts a tenant's previous landlord and employer directly via WhatsApp on the landlord's behalf. If a referee does not respond, automated follow-up messages are sent at 2 days, 4 days, and 7 days. Reference summaries are included in the final screening report. Landlords never need to chase anyone — the entire reference workflow is handled autonomously, including escalation if referees remain unresponsive.",
  },
  {
    id: "after-move-in",
    question: "What happens after the tenant moves in?",
    answer:
      "After move-in, CompliLet's tenancy management suite activates automatically. This includes rent reminders sent to the tenant 3 days before each due date, graduated arrears chasing if rent is late, compliance deadline tracking for gas safety certificates, EICR, EPC, and deposit protection, AI-powered maintenance triage when tenants report issues, and quarterly photo-based property inspections with condition reports delivered via WhatsApp.",
  },
  {
    id: "overseas-landlords",
    question: "Can I use CompliLet if I live abroad?",
    answer:
      "Yes. CompliLet's Global Landlord plan (£29.99/month per property) is designed for overseas landlords managing UK properties remotely. It includes timezone-aware notifications, NRL1 tax compliance guidance, 24/7 emergency maintenance triage, and the full tenancy management suite. Landlords managing from Dubai, Singapore, Hong Kong, Sydney, or New York can run their UK portfolio entirely via WhatsApp, with no need to fly back for inspections or key handovers.",
  },
  {
    id: "data-security",
    question: "Is my data safe?",
    answer:
      "CompliLet is GDPR-compliant and ICO-registered. Tenant documents are encrypted at rest using AES-256 encryption and stored in access-controlled, UK-based cloud infrastructure. All documents are automatically deleted after 12 months in line with GDPR's data minimisation principle. Employment and income verification is handled by Konfir (part of Experian), which is UK Government DIATF certified, ICO registered, and ISO 27001 certified. CompliLet never sells or shares tenant data with third parties, and landlords can request full data deletion at any time via WhatsApp.",
  },
  {
    id: "human-support",
    question: "What if I need to speak to a real person?",
    answer:
      "Human escalation is built into every CompliLet workflow. If a situation requires human judgement — a safeguarding concern, a complex legal question, or a disputed tenancy — a qualified CompliLet support team member is notified and responds within 2 working hours. Human oversight is available on all plans at no extra cost. CompliLet never relies solely on AI for safety-critical decisions.",
  },
  {
    id: "cost-vs-agent",
    question: "How much does CompliLet cost compared to a letting agent?",
    answer:
      "A UK letting agent typically charges 10–15% of monthly rent for full management — £150–£300/month on a £1,500/month property. CompliLet starts at £4.99 per tenant screening and provides full tenancy management from £14.99 per property per month, saving most landlords £130–£270 every month. There are no setup fees, no minimum contracts, and subscriptions can be cancelled at any time.",
  },
  {
    id: "no-app",
    question: "Do I need to download an app?",
    answer:
      "No. CompliLet works entirely inside WhatsApp, which 92% of UK landlords already use. Landlords forward tenant enquiries to CompliLet's WhatsApp Business number; tenants receive messages on their existing WhatsApp; all reports are delivered via WhatsApp or email. There is no app to download, no new account for tenants to create, and no password to remember.",
  },
  {
    id: "phone-number-privacy",
    question: "Can tenants see my phone number?",
    answer:
      "No. All communication between landlords and tenants through CompliLet is routed through CompliLet's WhatsApp Business number. The landlord's personal or business mobile number is never visible to tenants at any stage of the screening, reference, or tenancy management process. This provides complete separation between a landlord's personal contact details and their rental business.",
  },
] as const;

export type FAQ = (typeof FAQS)[number];
