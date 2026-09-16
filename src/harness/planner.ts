import type { ToolName } from "../auth.ts";
import { advertisedTools } from "../auth.ts";
import type { Priority, Role } from "../ontology.ts";

export type PlannedCall = {
  tool: ToolName;
  arguments: Record<string, unknown>;
};

export type Plan = {
  planner: "mock" | "openai" | "anthropic";
  rationale: string;
  calls: PlannedCall[];
};

const NAME_HINTS: Array<{ query: string; keys: string[] }> = [
  { query: "Maya Chen", keys: ["maya"] },
  { query: "Jordan Hale", keys: ["jordan", "northwind"] },
  { query: "Priya Shah", keys: ["priya"] },
];

function has(text: string, ...needles: string[]): boolean {
  const hay = text.toLowerCase();
  return needles.every((n) => hay.includes(n.toLowerCase()));
}

function any(text: string, ...needles: string[]): boolean {
  const hay = text.toLowerCase();
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

function contactQuery(utterance: string): string | undefined {
  const hit = NAME_HINTS.find((row) => row.keys.some((key) => utterance.toLowerCase().includes(key)));
  return hit?.query;
}

function priorityOf(utterance: string): Priority {
  if (any(utterance, "p1", "sev1", "sev-1", "page", "outage", "failing", "exhausted")) return "p1";
  if (any(utterance, "p3", "low", "when you can")) return "p3";
  return "p2";
}

function allowed(role: Role, tool: ToolName): boolean {
  return advertisedTools(role).includes(tool);
}

/**
 * Deterministic planner used when no paid LLM key is set.
 * It is intentionally small: the product surface is the MCP tool boundary, not the planner.
 */
export function planWithMock(utterance: string, role: Role): Plan {
  const text = utterance.trim();
  const calls: PlannedCall[] = [];
  const contact = contactQuery(text);

  if (any(text, "who am i", "whoami", "what can i")) {
    calls.push({ tool: "whoami", arguments: {} });
  }

  if (any(text, "list contact", "show contact", "find contact") || (contact && any(text, "look up", "find"))) {
    calls.push({ tool: "contacts.list", arguments: { query: contact ?? text } });
  }

  if (any(text, "list case", "open cases", "show cases", "what is open")) {
    const status = any(text, "open") ? "open" : any(text, "resolved") ? "resolved" : undefined;
    calls.push({ tool: "cases.list", arguments: status ? { status } : {} });
  }

  if (any(text, "list task", "show task", "follow-up", "follow up") && !any(text, "create", "open a", "add a")) {
    calls.push({ tool: "tasks.list", arguments: {} });
  }

  const wantsCase =
    any(text, "open a case", "open case", "file a case", "create a case", "new case") ||
    (any(text, "webhook") && any(text, "fail"));
  if (wantsCase) {
    if (contact) {
      calls.push({ tool: "contacts.list", arguments: { query: contact } });
    }
    calls.push({
      tool: "cases.create",
      arguments: {
        contact_id: "$contact.id",
        title: titleFrom(text) ?? "Customer-reported issue",
        description: text,
        priority: priorityOf(text),
      },
    });
  }

  if (any(text, "follow-up", "follow up", "add a task", "create a task", "todo")) {
    calls.push({
      tool: "tasks.create",
      arguments: {
        case_id: "$case.id",
        title: taskTitleFrom(text),
      },
    });
  }

  if (any(text, "assign")) {
    calls.push({ tool: "cases.list", arguments: { status: "open" } });
    calls.push({
      tool: "cases.assign",
      arguments: {
        case_id: "$case.id",
        assignee_id: "pr_supervisor",
      },
    });
  }

  if (any(text, "resolve", "close the case", "mark resolved")) {
    calls.push({ tool: "cases.list", arguments: { status: "open" } });
    calls.push({
      tool: "cases.resolve",
      arguments: {
        case_id: "$case.id",
        resolution_code: "done",
        resolution_summary: "Resolved from the agent harness demo path.",
      },
    });
  }

  if (any(text, "complete the task", "mark the task done", "finish the task")) {
    calls.push({
      tool: "tasks.complete",
      arguments: { task_id: "$task.id" },
    });
  }

  if (any(text, "pause", "freeze") && contact) {
    calls.push({ tool: "contacts.list", arguments: { query: contact } });
    calls.push({
      tool: "contacts.update_status",
      arguments: { contact_id: "$contact.id", status: "paused" },
    });
  }

  if (any(text, "internal note", "add a note")) {
    calls.push({
      tool: "cases.add_internal_note",
      arguments: {
        case_id: "$case.id",
        body: "Internal note from the harness. Do not send this wording to the customer.",
      },
    });
  }

  if (calls.length === 0) {
    if (has(text, "maya") || has(text, "jordan") || has(text, "priya")) {
      calls.push({ tool: "contacts.list", arguments: { query: contact ?? text } });
      calls.push({ tool: "cases.list", arguments: {} });
    } else {
      calls.push({ tool: "whoami", arguments: {} });
      calls.push({ tool: "cases.list", arguments: { status: "open" } });
    }
  }

  const unique: PlannedCall[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const key = `${call.tool}:${JSON.stringify(call.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(call);
  }

  const gated = unique.filter((call) => allowed(role, call.tool));
  const dropped = unique.filter((call) => !allowed(role, call.tool)).map((call) => call.tool);

  const rationale = dropped.length
    ? `Mock planner mapped the utterance to ${unique.map((c) => c.tool).join(" → ")}. Dropped ${dropped.join(", ")} because role=${role} does not advertise them.`
    : `Mock planner mapped the utterance to ${gated.map((c) => c.tool).join(" → ") || "(nothing)"}.`;

  return { planner: "mock", rationale, calls: gated };
}

function titleFrom(text: string): string | undefined {
  if (any(text, "webhook")) return "Webhook retries exhausted";
  if (any(text, "invoice", "bill")) return "Invoice discrepancy";
  const match = text.match(/case[:\s]+([^.—]+)/i);
  return match?.[1]?.trim();
}

function taskTitleFrom(text: string): string {
  if (any(text, "retry", "secret", "signing")) return "Confirm the current signing secret is in use";
  if (any(text, "credit")) return "Draft the credit memo";
  return "Follow up with the customer";
}

export const DEMO_UTTERANCE =
  "Maya's webhook is failing — open a P1 case and a follow-up task to confirm they are sending the current signing secret.";
