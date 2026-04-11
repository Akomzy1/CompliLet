"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";

interface Message {
  id: string;
  session_id: string;
  role: string;
  content?: string;
  created_at: string;
}

interface Props {
  escalationId: string;
  messages: Message[];
  status: string;
  takeOverAction: (formData: FormData) => Promise<void>;
  resolveAction: (formData: FormData) => Promise<void>;
  escalateFurtherAction: (formData: FormData) => Promise<void>;
}

export function EscalationExpandRow({
  escalationId,
  messages,
  status,
  takeOverAction,
  resolveAction,
  escalateFurtherAction,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [showResolveForm, setShowResolveForm] = useState(false);

  const isResolved = status === "resolved" || status === "escalated_external";

  return (
    <div className="space-y-2">
      {/* Toggle conversation */}
      {messages.length > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-teal-700 hover:text-teal-900 font-medium"
        >
          {expanded ? "▲ Hide" : "▼ Show"} conversation ({messages.length} messages)
        </button>
      )}

      {expanded && (
        <div className="bg-white border border-gray-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-gray-50 text-sm">
          {messages.map((m) => (
            <div key={m.id} className="flex gap-3 px-3 py-2">
              <span
                className={`text-xs font-semibold w-14 flex-shrink-0 ${
                  m.role === "assistant" ? "text-teal-600" : "text-gray-500"
                }`}
              >
                {m.role}
              </span>
              <p className="flex-1 text-gray-700">{m.content}</p>
              <p className="text-xs text-gray-400 whitespace-nowrap">{formatDateTime(m.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {!isResolved && (
        <div className="flex flex-wrap gap-2 pt-1">
          {status === "open" && (
            <form action={takeOverAction}>
              <input type="hidden" name="id" value={escalationId} />
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Take Over
              </button>
            </form>
          )}

          <button
            onClick={() => setShowResolveForm((v) => !v)}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500"
          >
            Resolve
          </button>

          <form action={escalateFurtherAction}>
            <input type="hidden" name="id" value={escalationId} />
            <button
              type="submit"
              className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100"
              onClick={(e) => {
                if (!confirm("Escalate this case externally (solicitor / ICO)?")) {
                  e.preventDefault();
                }
              }}
            >
              Escalate Further
            </button>
          </form>
        </div>
      )}

      {/* Resolve form */}
      {showResolveForm && !isResolved && (
        <form action={resolveAction} className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <input type="hidden" name="id" value={escalationId} />
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Resolution notes *</label>
            <textarea
              name="resolution"
              required
              rows={3}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              placeholder="Describe what was done to resolve this escalation…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Resolved by</label>
            <input
              type="text"
              name="resolved_by"
              className="rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none"
              placeholder="Your name"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-500"
            >
              Confirm Resolve
            </button>
            <button
              type="button"
              onClick={() => setShowResolveForm(false)}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
