/**
 * CompliLet — PDF Certificate Utility
 *
 * Generates structured PDF documents for compliance records.
 * Uses pdf-lib (pure TypeScript, no Node.js streams — safe for Deno Edge Functions).
 *
 * Currently produces:
 *   - Right to Rent compliance certificates (Home Office Landlords' Code of Practice format)
 */

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// ─── Colour palette ────────────────────────────────────────────────────────

const NAVY   = rgb(0.082, 0.180, 0.298);   // #152E4C
const TEAL   = rgb(0.118, 0.557, 0.514);   // #1E8E83
const DARK   = rgb(0.102, 0.102, 0.118);   // #1A1A1E
const MID    = rgb(0.376, 0.376, 0.396);   // #606065
const LIGHT  = rgb(0.820, 0.820, 0.835);   // #D1D1D5
const WHITE  = rgb(1, 1, 1);
const RED    = rgb(0.796, 0.114, 0.114);   // #CC1D1D
const AMBER  = rgb(0.796, 0.502, 0.078);   // #CB8014

// ─── Layout constants ──────────────────────────────────────────────────────

const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN    = 48;
const CONTENT_W = A4_WIDTH - MARGIN * 2;

// ─── Right to Rent Certificate ─────────────────────────────────────────────

export interface RtrCertificateParams {
  /** ISO date-time string when the check was performed */
  checkedAt: string;
  /** Landlord full name */
  landlordName: string;
  /** Property address */
  propertyAddress: string;
  /** Tenant full name */
  tenantName: string;
  /** Tenant date of birth (ISO date) — optional */
  tenantDob?: string;
  /** Document type examined (e.g. "UK Passport") */
  documentType: string;
  /** Document reference / number */
  documentReference?: string;
  /** Document expiry date (ISO date) — present for List B */
  documentExpiry?: string;
  /** Home Office classification */
  classification: "List A – Group 1" | "List A – Group 2" | "List A – EUSS Settled Status" | "List B";
  /** True if an unlimited right to rent was confirmed */
  unlimitedRight: boolean;
  /** Follow-up check date (ISO date) — present for List B only */
  followUpDate?: string;
  /** Any notes for the landlord */
  notes?: string;
}

/**
 * Generates a Right to Rent compliance certificate as a PDF byte array.
 * Returns `Uint8Array` compatible with Supabase Storage `.upload()`.
 */
export async function generateRightToRentCertificate(
  params: RtrCertificateParams,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);

  // Embed fonts.
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let y = A4_HEIGHT; // current Y position — decrements as we draw downward

  // ── Header band ──────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 80,
    width: A4_WIDTH,
    height: 80,
    color: NAVY,
  });

  page.drawText("CompliLet", {
    x: MARGIN,
    y: A4_HEIGHT - 28,
    size: 20,
    font: bold,
    color: WHITE,
  });

  page.drawText("Right to Rent Compliance Certificate", {
    x: MARGIN,
    y: A4_HEIGHT - 52,
    size: 11,
    font: regular,
    color: rgb(0.70, 0.85, 0.83),
  });

  page.drawText(`Certificate No. CL-RTR-${certNumber(params.checkedAt)}`, {
    x: A4_WIDTH - MARGIN - 160,
    y: A4_HEIGHT - 36,
    size: 8,
    font: oblique,
    color: rgb(0.60, 0.75, 0.73),
  });

  y = A4_HEIGHT - 80;

  // ── Classification banner ─────────────────────────────────────────────────
  const bannerColor = params.unlimitedRight ? TEAL : AMBER;
  const bannerLabel = params.unlimitedRight
    ? `OK  ${params.classification} - UNLIMITED RIGHT TO RENT CONFIRMED`
    : `(!)  ${params.classification} - TIME-LIMITED RIGHT TO RENT (FOLLOW-UP REQUIRED)`;

  page.drawRectangle({ x: 0, y: y - 36, width: A4_WIDTH, height: 36, color: bannerColor });
  page.drawText(bannerLabel, {
    x: MARGIN,
    y: y - 24,
    size: 9.5,
    font: bold,
    color: WHITE,
  });
  y -= 36;

  // ── Date / reference strip ────────────────────────────────────────────────
  const checkDate = formatDate(params.checkedAt);
  drawSmallHeader(page, regular, "Date of Check", checkDate, MARGIN, y - 26);
  drawSmallHeader(
    page,
    regular,
    "Verification Method",
    "Remote — Digital copy via WhatsApp (CompliLet)",
    MARGIN + 180,
    y - 26,
  );
  y -= 48;

  // ── Divider ──────────────────────────────────────────────────────────────
  drawDivider(page, y);
  y -= 16;

  // ── Section: Parties ──────────────────────────────────────────────────────
  drawSectionHeader(page, bold, "Parties", y);
  y -= 20;

  y = drawLabelValue(page, bold, regular, "Landlord / Agent", params.landlordName, y);
  y = drawLabelValue(page, bold, regular, "Property Address",  params.propertyAddress, y);
  y = drawLabelValue(page, bold, regular, "Tenant Name",      params.tenantName, y);
  if (params.tenantDob) {
    y = drawLabelValue(page, bold, regular, "Tenant Date of Birth", formatDate(params.tenantDob), y);
  }

  y -= 8;
  drawDivider(page, y);
  y -= 16;

  // ── Section: Document Examined ────────────────────────────────────────────
  drawSectionHeader(page, bold, "Document Examined", y);
  y -= 20;

  y = drawLabelValue(page, bold, regular, "Document Type",      params.documentType, y);
  if (params.documentReference) {
    y = drawLabelValue(page, bold, regular, "Document Number",    params.documentReference, y);
  }
  if (params.documentExpiry) {
    y = drawLabelValue(page, bold, regular, "Expiry Date",        formatDate(params.documentExpiry), y);
  }

  y -= 8;
  drawDivider(page, y);
  y -= 16;

  // ── Section: Classification Result ───────────────────────────────────────
  drawSectionHeader(page, bold, "Classification Result", y);
  y -= 20;

  y = drawLabelValue(page, bold, regular, "Home Office List",   params.classification, y);
  y = drawLabelValue(
    page,
    bold,
    regular,
    "Right to Rent",
    params.unlimitedRight ? "Unlimited — no follow-up check required" : "Time-limited — follow-up check required",
    y,
  );

  if (!params.unlimitedRight && params.followUpDate) {
    // Highlight the follow-up date in amber.
    y -= 4;
    page.drawRectangle({
      x: MARGIN - 4,
      y: y - 20,
      width: CONTENT_W + 8,
      height: 24,
      color: rgb(0.996, 0.957, 0.867), // light amber background
      borderColor: AMBER,
      borderWidth: 1,
    });
    page.drawText("(!)  Follow-up check required by:", {
      x: MARGIN + 4,
      y: y - 14,
      size: 9,
      font: bold,
      color: AMBER,
    });
    page.drawText(formatDate(params.followUpDate), {
      x: MARGIN + 185,
      y: y - 14,
      size: 9,
      font: bold,
      color: DARK,
    });
    y -= 32;
  }

  if (params.notes) {
    y -= 4;
    y = drawLabelValue(page, bold, regular, "Notes", params.notes, y);
  }

  y -= 8;
  drawDivider(page, y);
  y -= 16;

  // ── Certification statement ───────────────────────────────────────────────
  drawSectionHeader(page, bold, "Certification", y);
  y -= 20;

  const certText =
    "This Right to Rent check was conducted by CompliLet on behalf of the landlord " +
    "named above, in accordance with the Immigration Act 2014, the Immigration Act 2016, " +
    "and the Home Office Landlords' Code of Practice (updated February 2024). " +
    "The documents listed above were examined as digital copies submitted via WhatsApp. " +
    "The landlord is advised to retain this certificate for the duration of the tenancy " +
    "plus 12 months, and to conduct follow-up checks where indicated.";

  y = drawWrappedText(page, regular, certText, MARGIN, y, CONTENT_W, 9, MID);

  y -= 16;

  // ── Legal disclaimer ──────────────────────────────────────────────────────
  drawDivider(page, y);
  y -= 12;

  const disclaimer =
    "CompliLet is an AI-assisted compliance tool and does not constitute legal advice. " +
    "The landlord remains legally responsible for conducting valid Right to Rent checks. " +
    "CompliLet Ltd is not liable for decisions made based on this certificate. " +
    "For complex cases or unusual documents, consult the Home Office Employer Checking Service " +
    "or an immigration law specialist.";

  y = drawWrappedText(page, oblique, disclaimer, MARGIN, y, CONTENT_W, 7.5, LIGHT);

  // ── Footer ────────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: 28, color: NAVY });
  page.drawText("complilet.co.uk  ·  Regulated under UK GDPR  ·  CompliLet Ltd", {
    x: MARGIN,
    y: 10,
    size: 7.5,
    font: regular,
    color: rgb(0.60, 0.75, 0.73),
  });
  page.drawText(`Generated ${checkDate}`, {
    x: A4_WIDTH - MARGIN - 90,
    y: 10,
    size: 7.5,
    font: regular,
    color: rgb(0.50, 0.65, 0.63),
  });

  const pdfBytes = await doc.save();
  return new Uint8Array(pdfBytes);
}

// ─── Layout helpers ────────────────────────────────────────────────────────

function drawDivider(page: PDFPage, y: number): void {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: LIGHT,
  });
}

function drawSectionHeader(
  page: PDFPage,
  font: PDFFont,
  label: string,
  y: number,
): void {
  page.drawText(label.toUpperCase(), {
    x: MARGIN,
    y,
    size: 8,
    font,
    color: TEAL,
    characterSpacing: 0.8,
  });
}

function drawSmallHeader(
  page: PDFPage,
  font: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
): void {
  page.drawText(`${label}:`, { x, y: y + 8, size: 7, font, color: rgb(0.7, 0.85, 0.83) });
  page.drawText(value,        { x, y,        size: 8, font, color: WHITE });
}

/** Draws a label/value pair and returns the new Y position. */
function drawLabelValue(
  page: PDFPage,
  boldFont: PDFFont,
  regularFont: PDFFont,
  label: string,
  value: string,
  y: number,
): number {
  const LABEL_W = 155;
  page.drawText(`${label}:`, {
    x: MARGIN,
    y,
    size: 8.5,
    font: boldFont,
    color: MID,
  });
  // Wrap long values.
  const lines = wrapText(value, CONTENT_W - LABEL_W, regularFont, 9);
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x: MARGIN + LABEL_W,
      y: y - i * 13,
      size: 9,
      font: regularFont,
      color: DARK,
    });
  }
  return y - Math.max(1, lines.length) * 13 - 4;
}

/** Draws wrapped text and returns new Y position. */
function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  color: ReturnType<typeof rgb>,
): number {
  const lines = wrapText(text, maxWidth, font, size);
  for (const line of lines) {
    page.drawText(line, { x, y, size, font, color });
    y -= size * 1.55;
  }
  return y;
}

/** Wraps text into lines fitting `maxWidth` at `size` pt. */
function wrapText(
  text: string,
  maxWidth: number,
  font: PDFFont,
  size: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const w = font.widthOfTextAtSize(candidate, size);
    if (w > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Generates a human-readable certificate number from the check timestamp. */
function certNumber(checkedAt: string): string {
  const d = new Date(checkedAt);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
    String(d.getHours()).padStart(2, "0"),
    String(d.getMinutes()).padStart(2, "0"),
  ].join("");
}

// ─── Move-In Pack ──────────────────────────────────────────────────────────

export interface MoveInPackParams {
  generatedAt: string;
  // Parties
  tenantName: string;
  tenantPhone: string;
  landlordName: string;
  propertyAddress: string;
  // Financials
  monthlyRentGbp: number;
  depositGbp: number;
  tenancyStartDate: string;
  tenancyDurationMonths?: number;
  // Screening provenance
  screeningScore: number;
  screeningDecision: "recommended" | "conditional" | "not_recommended";
  rtrClassification?: string;
  rtrFollowUpDate?: string;
  rtrCertificateRef?: string;
  references: Array<{
    type: "previous_landlord" | "employer";
    refereeName: string;
    outcome: string;
    summary: string;
  }>;
  // Compliance baseline (optional — present when landlord has prior records)
  lastGasSafetyDate?: string;
  lastEicrDate?: string;
  epcRating?: string;
  epcExpiryDate?: string;
}

/**
 * Generates a multi-page Move-In Pack PDF.
 * Returns a `Uint8Array` compatible with Supabase Storage `.upload()`.
 *
 * Page 1: Header · Tenancy Summary · Inventory Checklist (rooms 1–3)
 * Page 2: Inventory Checklist (rooms 4–7) · Utility Reminders · Council Tax
 * Page 3: Deposit Protection · Emergency Contacts · RTR Summary · Disclaimer
 */
export async function generateMoveInPack(p: MoveInPackParams): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  const fonts = { bold, regular, oblique };

  // ── Page 1 ──────────────────────────────────────────────────────────────
  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT;

  // Header band.
  y = _mipHeader(page, fonts, p, y);

  // Section 1: Tenancy Summary.
  y = _mipSection(page, bold, "1. Tenancy Summary", y);
  y = drawLabelValue(page, bold, regular, "Property Address",  p.propertyAddress, y);
  y = drawLabelValue(page, bold, regular, "Tenant",            p.tenantName, y);
  y = drawLabelValue(page, bold, regular, "Landlord",          p.landlordName, y);
  y = drawLabelValue(page, bold, regular, "Monthly Rent",      `£${p.monthlyRentGbp.toFixed(2)}`, y);
  y = drawLabelValue(page, bold, regular, "Security Deposit",  `£${p.depositGbp.toFixed(2)}`, y);
  y = drawLabelValue(page, bold, regular, "Tenancy Start",     formatDate(p.tenancyStartDate), y);
  if (p.tenancyDurationMonths) {
    y = drawLabelValue(page, bold, regular, "Initial Term", `${p.tenancyDurationMonths} months`, y);
  }
  y = drawLabelValue(
    page, bold, regular,
    "Deposit Protection Deadline",
    formatDate(addDays(p.tenancyStartDate, 30)) + " (30 days from start)",
    y,
  );
  y -= 8;
  drawDivider(page, y);
  y -= 20;

  // Section 2: Inventory Checklist.
  y = _mipSection(page, bold, "2. Inventory Checklist — Move-In Condition Report", y);
  y = drawWrappedText(
    page, regular,
    "Complete this checklist at key handover. Record the condition of each item, " +
    "then sign and date at the end. Both parties should retain a copy.",
    MARGIN, y, CONTENT_W, 8.5, MID,
  );
  y -= 10;

  // Rooms 1–2 fit on page 1 comfortably.
  y = _mipRoom(page, fonts, "Entrance / Hallway",
    ["Floor covering", "Walls & ceiling", "Window(s)", "Front door & locks", "Letterbox / intercom", "Light fitting"], y);
  y = _mipRoom(page, fonts, "Living Room",
    ["Floor covering", "Walls & ceiling", "Window(s) & blinds", "Door & lock", "Light fitting(s)", "Radiator / heating", "TV aerial point"], y);

  // ── Page 2 ──────────────────────────────────────────────────────────────
  page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  y = A4_HEIGHT - 48;
  _mipContinuationBand(page, fonts, "Section 2: Inventory Checklist (continued)");
  y -= 28;

  y = _mipRoom(page, fonts, "Kitchen / Dining",
    ["Floor covering", "Walls & ceiling", "Window(s) & blinds", "Door & lock", "Worktops & units", "Sink & plumbing", "Oven / hob / extractor", "Fridge / freezer", "Dishwasher (if supplied)", "Radiator / heating"], y);
  y = _mipRoom(page, fonts, "Bedroom 1",
    ["Floor covering", "Walls & ceiling", "Window(s) & blinds", "Door & lock", "Light fitting(s)", "Radiator / heating", "Fitted wardrobes (if any)"], y);
  y = _mipRoom(page, fonts, "Bedroom 2 (if applicable)",
    ["Floor covering", "Walls & ceiling", "Window(s) & blinds", "Door & lock", "Light fitting(s)", "Radiator / heating"], y);
  y = _mipRoom(page, fonts, "Bathroom / WC",
    ["Floor covering / tiles", "Walls & ceiling", "Window(s) / ventilation", "Bath / shower & screen", "Sink & taps", "Toilet & cistern", "Mirror / cabinet (if supplied)"], y);
  y = _mipRoom(page, fonts, "Garden / Exterior (if applicable)",
    ["Condition on handover", "Shed / outbuildings", "Fences & gates"], y);

  // Meter Readings box.
  y -= 8;
  drawDivider(page, y); y -= 16;
  page.drawText("METER READINGS AT MOVE-IN", { x: MARGIN, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.8 });
  y -= 16;
  for (const label of ["Gas meter reading", "Electricity reading (main)", "Electricity reading (off-peak / E7)", "Water meter reading (if accessible)"]) {
    page.drawText(`${label}:`, { x: MARGIN, y, size: 8.5, font: bold, color: MID });
    page.drawLine({ start: { x: MARGIN + 180, y: y - 1 }, end: { x: A4_WIDTH - MARGIN, y: y - 1 }, thickness: 0.5, color: LIGHT });
    y -= 16;
  }

  // Signatures box.
  y -= 4;
  drawDivider(page, y); y -= 16;
  page.drawText("INVENTORY SIGN-OFF", { x: MARGIN, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.8 });
  y -= 16;
  for (const [label, xPos] of [["Landlord / Agent", MARGIN], ["Tenant", MARGIN + 250]] as [string, number][]) {
    page.drawText(`${label} signature:`, { x: xPos, y, size: 8.5, font: bold, color: MID });
    page.drawLine({ start: { x: xPos + 120, y: y - 1 }, end: { x: xPos + 220, y: y - 1 }, thickness: 0.5, color: LIGHT });
    page.drawText("Date:", { x: xPos, y: y - 16, size: 8.5, font: bold, color: MID });
    page.drawLine({ start: { x: xPos + 35, y: y - 17 }, end: { x: xPos + 120, y: y - 17 }, thickness: 0.5, color: LIGHT });
  }
  y -= 40;

  // ── Page 3 ──────────────────────────────────────────────────────────────
  page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  y = A4_HEIGHT - 48;
  _mipContinuationBand(page, fonts, "Utility Reminders · Compliance · RTR Summary");
  y -= 28;

  // Section 3: Utility Switching.
  y = _mipSection(page, bold, "3. Utility & Service Switching Reminders", y);
  const utilities: Array<[string, string]> = [
    ["Gas supply",        "Contact current supplier or switch at uswitch.com · Transfer accounts within 48 hrs of move-in"],
    ["Electricity",       "Contact current supplier or switch at uswitch.com · Request final meter reading from seller"],
    ["Water",             "Register with your local water company — usually automatic. Check bill for supplier details"],
    ["Broadband",         "Book your installation in advance (allow 2 weeks). Compare at broadbandchoices.co.uk"],
    ["Council Tax",       "See Section 4 — register with the local council within the first week"],
    ["TV Licence",        "Required if watching live TV or using BBC iPlayer. Register at tvlicensing.co.uk"],
    ["Buildings ins.",    "Landlord's responsibility — confirm cover is in place before move-in"],
    ["Contents ins.",     "Tenant's responsibility — cover personal belongings from day one"],
  ];
  for (const [label, note] of utilities) {
    page.drawText(`•  ${label}`, { x: MARGIN, y, size: 9, font: bold, color: DARK });
    y = drawWrappedText(page, regular, note, MARGIN + 14, y - 11, CONTENT_W - 14, 8, MID);
    y -= 4;
  }
  y -= 8;
  drawDivider(page, y); y -= 16;

  // Section 4: Council Tax.
  y = _mipSection(page, bold, "4. Council Tax — How to Register", y);
  const ctSteps = [
    "Find your local council at gov.uk/council-tax (enter the property postcode).",
    "Select 'Moving home' or 'Register for Council Tax'.",
    "Provide your move-in date, full name(s) of occupants, and previous address.",
    "You may be eligible for a single-person discount (25%) if living alone.",
    "Full-time students are exempt — contact the council with proof of enrolment.",
    "Council Tax bills are issued annually but can be paid monthly in 10 instalments.",
  ];
  for (let i = 0; i < ctSteps.length; i++) {
    page.drawText(`${i + 1}.`, { x: MARGIN, y, size: 9, font: bold, color: TEAL });
    y = drawWrappedText(page, regular, ctSteps[i], MARGIN + 16, y, CONTENT_W - 16, 9, DARK);
    y -= 3;
  }
  y -= 8;
  drawDivider(page, y); y -= 16;

  // Section 5: Deposit Protection.
  const depositDeadline = formatDate(addDays(p.tenancyStartDate, 30));
  y = _mipSection(page, bold, "5. Deposit Protection (Landlord Action Required)", y);

  // Amber warning box.
  page.drawRectangle({ x: MARGIN - 4, y: y - 44, width: CONTENT_W + 8, height: 48, color: rgb(0.996, 0.957, 0.867), borderColor: AMBER, borderWidth: 1 });
  page.drawText("(!)  ACTION REQUIRED BY " + depositDeadline.toUpperCase(), { x: MARGIN + 4, y: y - 10, size: 8.5, font: bold, color: AMBER });
  y = drawWrappedText(page, regular,
    `The security deposit of £${p.depositGbp.toFixed(2)} must be registered with a government-approved ` +
    "scheme within 30 days of receipt, and the tenant must be given Prescribed Information within the same period.",
    MARGIN + 4, y - 24, CONTENT_W - 8, 8.5, DARK);
  y -= 16;

  y = drawWrappedText(page, regular,
    "Approved schemes: Deposit Protection Service (DPS) · mydeposits · Tenancy Deposit Scheme (TDS)\n" +
    "Register at: depositprotection.com  ·  mydeposits.co.uk  ·  tenancydepositscheme.com",
    MARGIN, y, CONTENT_W, 8.5, MID);
  y -= 12;
  drawDivider(page, y); y -= 16;

  // Section 6: Emergency Contacts.
  y = _mipSection(page, bold, "6. Emergency Contacts — Complete at Handover", y);
  const emergencyRows: Array<[string, string]> = [
    ["Gas emergency (National Grid)", "0800 111 999 (free, 24/7)"],
    ["Electricity emergency",         "105 (free, 24/7)"],
    ["Water emergency",               "Call your local water company"],
    ["Police non-emergency",          "101"],
    ["NHS non-emergency",             "111"],
    ["Landlord / agent",              ""],
    ["Out-of-hours emergency repair", ""],
    ["Boiler / heating contractor",   ""],
    ["Trusted plumber",               ""],
    ["Trusted electrician",           ""],
  ];
  y = _mipContactsTable(page, fonts, emergencyRows, y);
  y -= 12;
  drawDivider(page, y); y -= 16;

  // Section 7: Right to Rent Summary.
  y = _mipSection(page, bold, "7. Right to Rent — Summary", y);
  if (p.rtrClassification) {
    y = drawLabelValue(page, bold, regular, "Classification", p.rtrClassification, y);
  }
  if (p.rtrCertificateRef) {
    y = drawLabelValue(page, bold, regular, "Certificate Ref.", `CL-RTR-${p.rtrCertificateRef}`, y);
  }
  if (p.rtrFollowUpDate) {
    y = drawLabelValue(page, bold, regular, "Follow-up Check Due", formatDate(p.rtrFollowUpDate), y);
    y -= 4;
    y = drawWrappedText(page, regular,
      "CompliLet will send an automated reminder 60, 30, 14, and 7 days before the follow-up date.",
      MARGIN, y, CONTENT_W, 8.5, MID);
  } else {
    y = drawWrappedText(page, regular,
      "Unlimited right to rent confirmed — no follow-up check required.",
      MARGIN, y, CONTENT_W, 8.5, MID);
  }
  y -= 16;

  // Screening provenance footnote.
  if (p.references.length > 0) {
    drawDivider(page, y); y -= 12;
    page.drawText("REFERENCES", { x: MARGIN, y, size: 8, font: bold, color: TEAL, characterSpacing: 0.8 });
    y -= 14;
    for (const ref of p.references) {
      const typeLabel = ref.type === "previous_landlord" ? "Previous Landlord" : "Employer";
      page.drawText(`${typeLabel} — ${ref.refereeName}:`, { x: MARGIN, y, size: 8.5, font: bold, color: MID });
      page.drawText(ref.outcome.charAt(0).toUpperCase() + ref.outcome.slice(1), {
        x: MARGIN + 200, y, size: 8.5, font: bold,
        color: ref.outcome === "positive" ? TEAL : ref.outcome === "negative" ? RED : DARK,
      });
      y -= 13;
      y = drawWrappedText(page, oblique, ref.summary, MARGIN + 8, y, CONTENT_W - 8, 8, MID);
      y -= 6;
    }
  }

  // Legal disclaimer + footer.
  y = Math.min(y, 80);
  drawDivider(page, y); y -= 12;
  drawWrappedText(page, oblique,
    "This document was generated by CompliLet and does not constitute legal advice. " +
    "The landlord remains responsible for ensuring compliance with all applicable legislation, " +
    "including the Landlord and Tenant Act 1985, the Housing Act 1988 (as amended), and the " +
    "Renters' Rights Act 2026. For legal advice please consult a qualified solicitor.",
    MARGIN, y, CONTENT_W, 7.5, LIGHT);

  // Footer on every page.
  const generatedLabel = `Generated ${formatDate(p.generatedAt)}`;
  for (const pg of doc.getPages()) {
    pg.drawRectangle({ x: 0, y: 0, width: A4_WIDTH, height: 28, color: NAVY });
    pg.drawText("complilet.co.uk  ·  CompliLet Ltd  ·  Regulated under UK GDPR", {
      x: MARGIN, y: 10, size: 7.5, font: regular, color: rgb(0.60, 0.75, 0.73),
    });
    pg.drawText(generatedLabel, {
      x: A4_WIDTH - MARGIN - 90, y: 10, size: 7.5, font: regular, color: rgb(0.50, 0.65, 0.63),
    });
  }

  const bytes = await doc.save();
  return new Uint8Array(bytes);
}

// ─── Move-In Pack layout helpers ───────────────────────────────────────────

/** Draws the title header band for page 1. Returns new Y. */
function _mipHeader(
  page: PDFPage,
  fonts: { bold: PDFFont; regular: PDFFont },
  p: MoveInPackParams,
  y: number,
): number {
  // Navy header.
  page.drawRectangle({ x: 0, y: y - 80, width: A4_WIDTH, height: 80, color: NAVY });
  page.drawText("CompliLet", { x: MARGIN, y: y - 28, size: 20, font: fonts.bold, color: WHITE });
  page.drawText("Move-In Pack", { x: MARGIN, y: y - 52, size: 11, font: fonts.regular, color: rgb(0.70, 0.85, 0.83) });
  page.drawText(`Generated ${formatDate(p.generatedAt)}`, {
    x: A4_WIDTH - MARGIN - 115, y: y - 36, size: 8, font: fonts.regular, color: rgb(0.60, 0.75, 0.73),
  });
  y -= 80;

  // Teal address banner.
  page.drawRectangle({ x: 0, y: y - 36, width: A4_WIDTH, height: 36, color: TEAL });
  page.drawText(`${p.tenantName}  ·  ${p.propertyAddress}`, {
    x: MARGIN, y: y - 24, size: 9.5, font: fonts.bold, color: WHITE,
  });
  y -= 36;
  y -= 16; // top padding for first section
  return y;
}

/** Draws the thin continuation band on pages 2+. */
function _mipContinuationBand(
  page: PDFPage,
  fonts: { bold: PDFFont; regular: PDFFont },
  subtitle: string,
): void {
  page.drawRectangle({ x: 0, y: A4_HEIGHT - 28, width: A4_WIDTH, height: 28, color: NAVY });
  page.drawText("CompliLet Move-In Pack", { x: MARGIN, y: A4_HEIGHT - 19, size: 8, font: fonts.bold, color: rgb(0.60, 0.75, 0.73) });
  page.drawText(subtitle, { x: MARGIN + 140, y: A4_HEIGHT - 19, size: 8, font: fonts.regular, color: rgb(0.60, 0.75, 0.73) });
}

/** Draws a section heading in teal caps, returns new Y. */
function _mipSection(page: PDFPage, boldFont: PDFFont, label: string, y: number): number {
  page.drawText(label.toUpperCase(), { x: MARGIN, y, size: 8.5, font: boldFont, color: TEAL, characterSpacing: 0.5 });
  return y - 18;
}

/** Draws a checklist room table. Returns new Y. */
function _mipRoom(
  page: PDFPage,
  fonts: { bold: PDFFont; regular: PDFFont },
  roomName: string,
  items: string[],
  y: number,
): number {
  const ITEM_W  = 200;
  const CHK_W   = 16;
  const CHK_GAP = 4;
  const FOUR_CHKS = (CHK_W + CHK_GAP) * 4;
  const NOTES_X = MARGIN + ITEM_W + FOUR_CHKS + 8;
  const ROW_H   = 16;

  // Room header row.
  page.drawRectangle({ x: MARGIN, y: y - ROW_H + 2, width: CONTENT_W, height: ROW_H, color: rgb(0.93, 0.95, 0.97) });
  page.drawText(roomName, { x: MARGIN + 4, y: y - 11, size: 8.5, font: fonts.bold, color: NAVY });
  y -= ROW_H;

  // Column headers.
  page.drawText("Item", { x: MARGIN + 4, y: y - 11, size: 7.5, font: fonts.bold, color: MID });
  let cx = MARGIN + ITEM_W;
  for (const lbl of ["E", "G", "F", "P"]) {
    page.drawText(lbl, { x: cx + 4, y: y - 11, size: 7.5, font: fonts.bold, color: MID });
    cx += CHK_W + CHK_GAP;
  }
  page.drawText("Notes", { x: NOTES_X, y: y - 11, size: 7.5, font: fonts.bold, color: MID });
  y -= ROW_H;

  // Item rows.
  for (const item of items) {
    // Alternating stripe.
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.3, color: LIGHT });
    page.drawText(item, { x: MARGIN + 4, y: y - 11, size: 8, font: fonts.regular, color: DARK });
    cx = MARGIN + ITEM_W;
    for (let i = 0; i < 4; i++) {
      // Draw checkbox square.
      page.drawRectangle({ x: cx + 2, y: y - 13, width: 9, height: 9, borderColor: LIGHT, borderWidth: 0.8, color: WHITE });
      cx += CHK_W + CHK_GAP;
    }
    // Notes underline.
    page.drawLine({ start: { x: NOTES_X, y: y - 14 }, end: { x: MARGIN + CONTENT_W - 4, y: y - 14 }, thickness: 0.4, color: LIGHT });
    y -= ROW_H;
  }

  // Bottom border of room.
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.5, color: MID });
  y -= 12;
  return y;
}

/** Draws the emergency contacts table. Returns new Y. */
function _mipContactsTable(
  page: PDFPage,
  fonts: { bold: PDFFont; regular: PDFFont },
  rows: Array<[string, string]>,
  y: number,
): number {
  const COL1_W = 220;
  const ROW_H  = 18;

  // Header row.
  page.drawRectangle({ x: MARGIN, y: y - ROW_H + 2, width: CONTENT_W, height: ROW_H, color: rgb(0.93, 0.95, 0.97) });
  page.drawText("Contact", { x: MARGIN + 4, y: y - 12, size: 8, font: fonts.bold, color: NAVY });
  page.drawText("Number / Details", { x: MARGIN + COL1_W + 4, y: y - 12, size: 8, font: fonts.bold, color: NAVY });
  y -= ROW_H;

  for (const [label, number] of rows) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.3, color: LIGHT });
    page.drawText(label, { x: MARGIN + 4, y: y - 12, size: 8.5, font: fonts.bold, color: DARK });
    if (number) {
      page.drawText(number, { x: MARGIN + COL1_W + 4, y: y - 12, size: 8.5, font: fonts.regular, color: DARK });
    } else {
      // Blank fill-in line.
      page.drawLine({
        start: { x: MARGIN + COL1_W + 4, y: y - 14 },
        end:   { x: MARGIN + CONTENT_W - 4, y: y - 14 },
        thickness: 0.5, color: LIGHT,
      });
    }
    y -= ROW_H;
  }
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.5, color: MID });
  return y;
}

/** Adds `days` to an ISO date string. Returns ISO date string. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().substring(0, 10);
}

/** Formats an ISO date/datetime string to UK locale (e.g. "14 March 2026"). */
export function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
