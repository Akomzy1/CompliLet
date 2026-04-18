/**
 * CompliLet — Pre-Qualifier Agent
 *
 * The first specialist agent in the tenant screening pipeline.
 * Handles the "pre_qualifying" session stage.
 *
 * Responsibilities:
 *   - Collects 10 data points from the tenant via WhatsApp conversation
 *   - Scores the tenant against the landlord's criteria
 *   - Signals a handoff to "collecting_docs" when pre-qualification is complete
 *   - Signals "abandon" if the tenant withdraws
 *
 * Claude integration:
 *   - Uses claude-sonnet-4-6 with the pre-qualifier.md system prompt
 *   - Conversation history is loaded from the messages table
 *   - The system prompt instructs Claude to embed a [COMPLILET_ACTION] sentinel
 *     in its response when it's ready to hand off to the next stage
 *
 * Called by: coordinator.ts (not an Edge Function — shared module only)
 */

import Anthropic from "npm:@anthropic-ai/sdk@0.24";
import { supabase } from "../supabase.ts";
import { sendTextMessage } from "../whatsapp.ts";
import { MODELS, CLAUDE_MAX_TOKENS } from "../constants.ts";
import type { ParsedMessage, SessionStatus } from "../types.ts";

// ─── Public interface ──────────────────────────────────────────────────────

export interface PreQualifierInput {
  message: ParsedMessage;
  sessionId: string;
  landlordId: string;
  mediaStorageUrl?: string;
  /**
   * Called by the agent when it signals a handoff or abandon.
   * The coordinator uses this to update session state and route onwards.
   */
  onHandoff: (nextStatus: SessionStatus, data: HandoffData) => Promise<void>;
}

export interface HandoffData {
  score?: number;
  summary?: PreQualifierSummary;
  abandonReason?: string;
}

export interface PreQualifierSummary {
  name: string;
  currentAddress: string;
  employmentStatus: string;
  employerName: string;
  monthlyIncomeGbp: number;
  moveInDate: string;
  occupants: number;
  children: number[];
  pets: string;
  smoking: boolean;
  reasonForMoving: string;
  redFlags: string[];
  notes: string;
}

// ─── Sentinel parsing ──────────────────────────────────────────────────────

const ACTION_SENTINEL_RE =
  /\[COMPLILET_ACTION:\s*(\{[\s\S]*?\})\]/;

interface HandoffAction {
  type: "handoff";
  to: SessionStatus;
  score: number;
  summary: PreQualifierSummary;
}

interface AbandonAction {
  type: "abandon";
  reason: string;
}

type AgentAction = HandoffAction | AbandonAction;

function extractAction(text: string): { action: AgentAction | null; cleanText: string } {
  const match = ACTION_SENTINEL_RE.exec(text);
  if (!match) return { action: null, cleanText: text };

  let action: AgentAction | null = null;
  try {
    action = JSON.parse(match[1]) as AgentAction;
  } catch (err) {
    console.error("Failed to parse agent action JSON:", match[1], err);
  }

  const cleanText = text.replace(ACTION_SENTINEL_RE, "").trim();
  return { action, cleanText };
}

// ─── Main agent function ───────────────────────────────────────────────────

export async function runPreQualifier(input: PreQualifierInput): Promise<void> {
  const { message, sessionId, landlordId, mediaStorageUrl, onHandoff } = input;
  const tenantPhone = message.from;

  try {
    // 1. Load conversation history for this session.
    const history = await loadConversationHistory(sessionId, tenantPhone);

    // 2. Load landlord criteria and property details.
    const context = await loadSessionContext(sessionId, landlordId);

    // 3. Build the system prompt with landlord context injected.
    const systemPrompt = await buildSystemPrompt(context);

    // 4. Append the current message to the history.
    const currentUserContent = buildUserContent(message, mediaStorageUrl);
    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user", content: currentUserContent },
    ];

    // 5. Call Claude.
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY"),
    });

    const response = await anthropic.messages.create({
      model: MODELS.FAST,
      max_tokens: CLAUDE_MAX_TOKENS,
      system: systemPrompt,
      messages,
    });

    const rawText = extractTextFromResponse(response);

    // 6. Parse the response for an action sentinel.
    const { action, cleanText } = extractAction(rawText);

    // 7. Send the clean text back to the tenant (without the sentinel).
    if (cleanText) {
      await sendTextMessage(tenantPhone, cleanText);
    }

    // 8. Log the agent interaction.
    await logAgentInteraction({
      sessionId,
      landlordId,
      tenantPhone,
      inputText: message.text ?? "[media]",
      outputText: rawText,
      action,
      messageId: message.messageId,
    });

    // 9. Handle handoff or abandon if signalled.
    if (action) {
      if (action.type === "handoff") {
        // Save pre-qualifying data to the session before handing off.
        await savePreQualifyingData(sessionId, action.score, action.summary);
        await onHandoff(action.to, {
          score: action.score,
          summary: action.summary,
        });
      } else if (action.type === "abandon") {
        await onHandoff("abandoned", { abandonReason: action.reason });
      }
    }
  } catch (err) {
    console.error(`Pre-qualifier error (session ${sessionId}):`, err);
    // Send a fallback message so the tenant doesn't get silence.
    await sendTextMessage(
      tenantPhone,
      "I'm having a technical issue right now. Please send your message again in a moment.",
    ).catch(() => {});
    throw err;
  }
}

// ─── Context loading ───────────────────────────────────────────────────────

interface SessionContext {
  propertyAddress: string;
  monthlyRentGbp: number;
  criteriaJson: Record<string, unknown>;
  tenantPhone: string;
}

async function loadSessionContext(
  sessionId: string,
  landlordId: string,
): Promise<SessionContext> {
  const [sessionResult, landlordResult] = await Promise.all([
    supabase
      .from("screening_sessions")
      .select("property_address, monthly_rent_gbp, tenant_phone")
      .eq("id", sessionId)
      .single(),
    supabase
      .from("landlords")
      .select("criteria_json")
      .eq("id", landlordId)
      .single(),
  ]);

  const session = sessionResult.data;
  const landlord = landlordResult.data;

  return {
    propertyAddress: session?.property_address ?? "Not specified",
    monthlyRentGbp: session?.monthly_rent_gbp ?? 0,
    criteriaJson: landlord?.criteria_json ?? {},
    tenantPhone: session?.tenant_phone ?? "",
  };
}

// ─── Conversation history ──────────────────────────────────────────────────

async function loadConversationHistory(
  sessionId: string,
  tenantPhone: string,
): Promise<Anthropic.MessageParam[]> {
  // Load all messages for this session involving this tenant phone.
  // Inbound from tenant → role: "user"
  // Outbound to tenant → role: "assistant"
  const { data: rows, error } = await supabase
    .from("messages")
    .select("direction, text, type, received_at")
    .eq("session_id", sessionId)
    .or(`from_phone.eq.${tenantPhone},to_phone.eq.${tenantPhone}`)
    .not("text", "is", null)
    .order("received_at", { ascending: true })
    .limit(80); // Cap at 80 messages to stay within context window

  if (error) {
    console.error("Failed to load conversation history:", error.message);
    return [];
  }

  if (!rows || rows.length === 0) return [];

  const history: Anthropic.MessageParam[] = [];

  for (const row of rows) {
    const role: "user" | "assistant" =
      row.direction === "inbound" ? "user" : "assistant";
    const content = row.text?.trim();
    if (!content) continue;

    // Claude requires alternating user/assistant turns.
    // If the last message has the same role, merge into it.
    const last = history[history.length - 1];
    if (last && last.role === role) {
      if (typeof last.content === "string") {
        last.content += `\n\n${content}`;
      }
    } else {
      history.push({ role, content });
    }
  }

  // Claude messages array must start with a user turn.
  while (history.length > 0 && history[0].role !== "user") {
    history.shift();
  }

  return history;
}

// ─── System prompt builder ─────────────────────────────────────────────────

async function buildSystemPrompt(context: SessionContext): Promise<string> {
  // Load the base prompt from the markdown file.
  const promptPath = new URL("../prompts/pre-qualifier.md", import.meta.url);
  const basePrompt = await Deno.readTextFile(promptPath);

  // Inject landlord context at the top so Claude has it before the instructions.
  const contextBlock = [
    "## Session Context (do not share verbatim with tenant)\n",
    `**Property**: ${context.propertyAddress}`,
    `**Monthly rent**: £${context.monthlyRentGbp}/month`,
    "**Landlord criteria**:",
    "```json",
    JSON.stringify(context.criteriaJson, null, 2),
    "```",
    "",
  ].join("\n");

  return `${contextBlock}\n---\n\n${basePrompt}`;
}

// ─── Message content builder ───────────────────────────────────────────────

function buildUserContent(
  message: ParsedMessage,
  mediaStorageUrl?: string,
): string {
  const parts: string[] = [];

  if (message.text) {
    parts.push(message.text);
  }

  if (message.media) {
    const mediaDescription =
      message.media.mimeType?.startsWith("image/")
        ? "[Tenant sent an image"
        : message.media.mimeType === "application/pdf"
        ? "[Tenant sent a PDF document"
        : "[Tenant sent a media file";

    const stored = mediaStorageUrl
      ? ` (stored at: ${mediaStorageUrl})`
      : " (media download pending)";

    const caption = message.media.caption ? ` — caption: "${message.media.caption}"` : "";
    parts.push(`${mediaDescription}${caption}${stored}]`);
  }

  if (message.interactive) {
    parts.push(`[Tenant tapped button: "${message.interactive.title}"]`);
  }

  return parts.join("\n") || "[No text content]";
}

// ─── Response extraction ───────────────────────────────────────────────────

function extractTextFromResponse(
  response: Anthropic.Message,
): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as Anthropic.TextBlock).text)
    .join("")
    .trim();
}

// ─── Data persistence ──────────────────────────────────────────────────────

async function savePreQualifyingData(
  sessionId: string,
  score: number,
  summary: PreQualifierSummary,
): Promise<void> {
  const { error } = await supabase
    .from("screening_sessions")
    .update({
      pre_qualifying_score: score,
      pre_qualifying_summary: summary,
      pre_qualifying_completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (error) {
    console.error(
      `Failed to save pre-qualifying data for session ${sessionId}:`,
      error.message,
    );
  }
}

async function logAgentInteraction(params: {
  sessionId: string;
  landlordId: string;
  tenantPhone: string;
  inputText: string;
  outputText: string;
  action: AgentAction | null;
  messageId: string;
}): Promise<void> {
  const { error } = await supabase.from("agent_logs").insert({
    session_id: params.sessionId,
    landlord_id: params.landlordId,
    agent_type: "screener",
    agent_subtype: "pre_qualifier",
    input: {
      text: params.inputText,
      whatsapp_message_id: params.messageId,
    },
    output: {
      text: params.outputText,
      action: params.action,
    },
    created_at: new Date().toISOString(),
  });

  if (error) {
    // Non-fatal — log but don't fail the agent.
    console.error("Failed to log agent interaction:", error.message);
  }
}
