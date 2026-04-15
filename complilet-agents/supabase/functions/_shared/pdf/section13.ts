/**
 * CompliLet — Section 13 Form 4A PDF Generator
 *
 * Generates the prescribed Section 13 Notice of Rent Increase (Form 4A) as a PDF.
 *
 * Form 4A is a PRESCRIBED FORM under the Housing Act 1988 (as amended by the
 * Renters' Rights Act 2025). It is the ONLY legal method to increase rent on a
 * periodic assured tenancy in England.
 *
 * Every required field is populated from the params object.
 * This is DETERMINISTIC document generation — not LLM-drafted.
 * An incomplete or incorrect Form 4A is invalid. Always populate all fields.
 *
 * Uses pdf-lib (pure TypeScript, no Node.js streams — safe for Deno Edge Functions).
 */

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

// ─── Colour palette ────────────────────────────────────────────────────────

const NAVY  = rgb(0.059, 0.169, 0.275);  // #0F2B46
const TEAL  = rgb(0.051, 0.580, 0.471);  // #0D9488
const DARK  = rgb(0.067, 0.094, 0.153);  // #111827
const MID   = rgb(0.420, 0.447, 0.502);  // #6B7280
const WHITE = rgb(1, 1, 1);
const LIGHT = rgb(0.878, 0.961, 0.953);  // #E0F5F3 — light teal

// ─── Layout ───────────────────────────────────────────────────────────────

const A4_W  = 595.28;
const A4_H  = 841.89;
const MARGIN = 50;
const CW     = A4_W - MARGIN * 2;

// ─── Public Interface ──────────────────────────────────────────────────────

export interface Section13Params {
  /** Full name of landlord (or company name) */
  landlordName: string;
  /** Correspondence address of landlord */
  landlordAddress: string;
  /** Full name of tenant(s) */
  tenantName: string;
  /** Full address of the rental property */
  propertyAddress: string;
  /** Current monthly rent in GBP */
  currentRent: number;
  /** Proposed new monthly rent in GBP */
  proposedRent: number;
  /** ISO date when the new rent takes effect (minimum 2 months from noticeSentDate) */
  effectiveDate: string;
  /** ISO date when this notice was served */
  noticeSentDate: string;
}

/**
 * Generates a Section 13 Form 4A PDF.
 * Returns raw PDF bytes suitable for upload to Supabase Storage.
 */
export async function generateSection13PDF(params: Section13Params): Promise<Uint8Array> {
  const {
    landlordName, landlordAddress, tenantName, propertyAddress,
    currentRent, proposedRent, effectiveDate, noticeSentDate,
  } = params;

  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([A4_W, A4_H]);
  const bold   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg    = await pdfDoc.embedFont(StandardFonts.Helvetica);

  let y = A4_H - MARGIN;

  // ── Header bar ──────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: A4_H - 70, width: A4_W, height: 70, color: NAVY });
  page.drawText("CompliLet", { x: MARGIN, y: A4_H - 28, font: bold, size: 18, color: WHITE });
  page.drawText("AI-Powered Property Management", { x: MARGIN, y: A4_H - 44, font: reg, size: 10, color: rgb(0.8, 0.9, 0.95) });
  page.drawText("complilet.ai", { x: A4_W - MARGIN - 70, y: A4_H - 36, font: reg, size: 10, color: TEAL });
  y = A4_H - 80;

  // ── Document title ───────────────────────────────────────────────────────
  y -= 24;
  page.drawText("SECTION 13 NOTICE OF RENT INCREASE", { x: MARGIN, y, font: bold, size: 14, color: NAVY });
  y -= 14;
  page.drawText("Housing Act 1988, Section 13 (as amended by the Renters' Rights Act 2025) — Form 4A", {
    x: MARGIN, y, font: reg, size: 9, color: MID,
  });
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_W - MARGIN, y }, thickness: 1, color: TEAL });

  // ── Addresses block ──────────────────────────────────────────────────────
  y -= 20;
  const col1X = MARGIN;
  const col2X = MARGIN + CW / 2 + 10;

  // Landlord
  page.drawText("LANDLORD", { x: col1X, y, font: bold, size: 8, color: TEAL });
  y -= 14;
  for (const line of wrapText(landlordName, bold, 9, CW / 2 - 20)) {
    page.drawText(line, { x: col1X, y, font: bold, size: 9, color: DARK });
    y -= 12;
  }
  for (const line of wrapText(landlordAddress, reg, 9, CW / 2 - 20)) {
    page.drawText(line, { x: col1X, y, font: reg, size: 9, color: DARK });
    y -= 12;
  }

  // Reset y to same row for right column
  let y2 = A4_H - 80 - 24 - 14 - 6 - 20;
  page.drawText("TENANT(S)", { x: col2X, y: y2, font: bold, size: 8, color: TEAL });
  y2 -= 14;
  for (const line of wrapText(tenantName, bold, 9, CW / 2 - 20)) {
    page.drawText(line, { x: col2X, y: y2, font: bold, size: 9, color: DARK });
    y2 -= 12;
  }
  page.drawText("PROPERTY ADDRESS", { x: col2X, y: y2 - 6, font: bold, size: 8, color: TEAL });
  y2 -= 20;
  for (const line of wrapText(propertyAddress, reg, 9, CW / 2 - 20)) {
    page.drawText(line, { x: col2X, y: y2, font: reg, size: 9, color: DARK });
    y2 -= 12;
  }

  // Take the lower of the two columns for next section
  y = Math.min(y, y2) - 8;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_W - MARGIN, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

  // ── Rent table ───────────────────────────────────────────────────────────
  y -= 20;
  page.drawText("RENT INCREASE DETAILS", { x: MARGIN, y, font: bold, size: 10, color: NAVY });

  y -= 16;
  drawRow(page, bold, reg, MARGIN, y, "Current monthly rent", `£${currentRent.toFixed(2)}`, CW);
  y -= 22;
  drawRow(page, bold, reg, MARGIN, y, "Proposed new monthly rent", `£${proposedRent.toFixed(2)}`, CW, LIGHT, TEAL);
  y -= 22;
  const increase = proposedRent - currentRent;
  const pct = currentRent > 0 ? ((increase / currentRent) * 100).toFixed(1) : "0.0";
  drawRow(page, bold, reg, MARGIN, y, "Increase", `£${increase.toFixed(2)}/month (+${pct}%)`, CW);
  y -= 22;
  drawRow(page, bold, reg, MARGIN, y, "Date this notice is served", formatDate(noticeSentDate), CW);
  y -= 22;
  drawRow(page, bold, reg, MARGIN, y, "Date new rent takes effect", formatDate(effectiveDate), CW, LIGHT, TEAL);

  // ── Statutory notice text ────────────────────────────────────────────────
  y -= 28;
  page.drawRectangle({ x: MARGIN, y: y - 60, width: CW, height: 80, color: rgb(0.98, 0.98, 0.98) });
  page.drawText("IMPORTANT — STATUTORY NOTICE", { x: MARGIN + 10, y: y + 10, font: bold, size: 9, color: NAVY });
  y -= 2;
  const noticeText =
    "This notice is served under Section 13 of the Housing Act 1988. The proposed new rent will take effect on " +
    "the date stated above unless you refer this notice to the First-tier Tribunal (Property Chamber) before " +
    "that date. The Tribunal will assess whether the proposed rent is at the prevailing open market rent " +
    "for the property.";
  let ny = y - 10;
  for (const line of wrapText(noticeText, reg, 8.5, CW - 20)) {
    page.drawText(line, { x: MARGIN + 10, y: ny, font: reg, size: 8.5, color: DARK });
    ny -= 11;
  }
  y = ny - 10;

  // ── Tenant rights box ────────────────────────────────────────────────────
  y -= 16;
  page.drawText("YOUR RIGHT TO CHALLENGE THIS NOTICE", { x: MARGIN, y, font: bold, size: 10, color: NAVY });
  y -= 14;

  const rights = [
    "You have the right to refer this notice to the First-tier Tribunal (Property Chamber) before the effective date.",
    "If you refer to the Tribunal, the new rent will NOT take effect until the Tribunal issues its determination.",
    "The Tribunal may set the rent at a figure lower than proposed if it determines the proposed rent exceeds market rate.",
    "You will NOT face any penalty or disadvantage for exercising your right to refer to the Tribunal.",
    "To refer: visit gov.uk/housing-tribunals or call the Tribunal Service on 0300 123 5174.",
    "Free advice: Citizens Advice — 0800 144 8848 (free, confidential, available to all tenants).",
  ];

  for (const right of rights) {
    page.drawText("•", { x: MARGIN, y, font: bold, size: 9, color: TEAL });
    for (const line of wrapText(right, reg, 9, CW - 14)) {
      page.drawText(line, { x: MARGIN + 10, y, font: reg, size: 9, color: DARK });
      y -= 12;
    }
  }

  // ── Signature block ──────────────────────────────────────────────────────
  y -= 20;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: A4_W - MARGIN, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  y -= 16;
  page.drawText("Served by:", { x: MARGIN, y, font: reg, size: 9, color: MID });
  page.drawText("On behalf of:", { x: col2X, y, font: reg, size: 9, color: MID });
  y -= 40;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 180, y }, thickness: 0.5, color: DARK });
  page.drawLine({ start: { x: col2X, y }, end: { x: col2X + 180, y }, thickness: 0.5, color: DARK });
  y -= 10;
  page.drawText("Signature / CompliLet AI", { x: MARGIN, y, font: reg, size: 8, color: MID });
  page.drawText(landlordName, { x: col2X, y, font: reg, size: 8, color: DARK });
  y -= 12;
  page.drawText(`Date: ${formatDate(noticeSentDate)}`, { x: MARGIN, y, font: reg, size: 8, color: MID });

  // ── Footer ───────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: A4_W, height: 28, color: rgb(0.97, 0.97, 0.97) });
  page.drawText(
    "Generated by CompliLet AI Property Management  ·  complilet.ai  ·  This notice must be retained for the duration of the tenancy plus 12 months.",
    { x: MARGIN, y: 10, font: reg, size: 7, color: MID },
  );

  return pdfDoc.save();
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function drawRow(
  page: ReturnType<PDFDocument["addPage"]>,
  bold: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  reg: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  x: number,
  y: number,
  label: string,
  value: string,
  contentWidth: number,
  bgColor = WHITE,
  valueColor = DARK,
): void {
  const rowH = 18;
  page.drawRectangle({ x, y: y - 4, width: contentWidth, height: rowH, color: bgColor });
  page.drawText(label, { x: x + 6, y: y + 2, font: reg, size: 9, color: MID });
  page.drawText(value, { x: x + contentWidth - 6 - bold.widthOfTextAtSize(value, 10), y: y + 2, font: bold, size: 10, color: valueColor });
}

function wrapText(
  text: string,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return isoDate;
  }
}
