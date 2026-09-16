import { advertisedTools, PRINCIPALS, type ToolName } from "../auth.ts";
import type { Priority, Role } from "../ontology.ts";

export type PlannedCall = { tool: ToolName; arguments: Record<string, unknown> };
export type Plan = {
  planner: "mock" | "openai" | "anthropic";
  rationale: string;
  calls: PlannedCall[];
  blockedReason?: string;
  denied?: ToolName[];
};

const NAME_HINTS = [
  { query: "Maya Chen", pattern: /\bmaya(?: chen)?\b/i },
  { query: "Jordan Hale", pattern: /\bjordan(?: hale)?\b|\bnorthwind\b/i },
  { query: "Priya Shah", pattern: /\bpriya(?: shah)?\b/i },
];

function blocked(reason: string, calls: PlannedCall[] = [], denied?: ToolName[]): Plan {
  return { planner: "mock", rationale: reason, calls, blockedReason: reason, ...(denied?.length ? { denied } : {}) };
}

function finish(calls: PlannedCall[], role: Role): Plan {
  const catalog = advertisedTools(role);
  const denied = calls.filter((call) => !catalog.includes(call.tool)).map((call) => call.tool);
  if (denied.length) {
    return blocked(
      `Dropped ${denied.join(", ")} because role=${role} does not advertise them. No part of this workflow will execute.`,
      calls.filter((call) => catalog.includes(call.tool)),
      denied,
    );
  }
  return { planner: "mock", rationale: `Explicit demo command: ${calls.map((call) => call.tool).join(" → ")}.`, calls };
}

function contactLookup(text: string): PlannedCall | undefined {
  const ids = [...text.matchAll(/\bct_[a-z0-9_-]+\b/gi)].map((match) => match[0]);
  const names = NAME_HINTS.filter((hint) => hint.pattern.test(text));
  if (ids.length === 1 && names.length === 0) return { tool: "contacts.get", arguments: { contact_id: ids[0] } };
  if (ids.length === 0 && names.length === 1) return { tool: "contacts.list", arguments: { query: names[0]!.query } };
  return undefined;
}

function priorityOf(text: string): Priority {
  if (/\b(?:p1|sev-?1)\b/i.test(text)) return "p1";
  if (/\bp3\b/i.test(text)) return "p3";
  return "p2";
}

/** A bounded demo grammar, not a general natural-language parser. */
export function planWithMock(utterance: string, role: Role): Plan {
  const text = utterance.trim().replaceAll("’", "'");
  if (!text || /\b(?:not|never|don't|dont|cannot|can't|without|avoid|cancel|unless|if|would|could|should|example|pretend|explain|describe)\b/i.test(text)) {
    return blocked("Use one affirmative demo command. Negated, conditional, and explanatory requests are not executed.");
  }
  if (/^(?:who am i|whoami|what can i do)[?.!]?$/i.test(text)) {
    return finish([{ tool: "whoami", arguments: {} }], role);
  }

  // Read commands have their own branch and can never fall through to writes.
  if (/^(?:list|show|find|get|look up)\b/i.test(text) || /^open cases[?.!]?$/i.test(text)) {
    const caseId = text.match(/\bcs_[a-z0-9_-]+\b/i)?.[0];
    const taskId = text.match(/\btk_[a-z0-9_-]+\b/i)?.[0];
    if (taskId) return finish([{ tool: "tasks.get", arguments: { task_id: taskId } }], role);
    if (caseId) return finish([{ tool: "cases.get", arguments: { case_id: caseId } }], role);
    if (/\b(?:tasks?|follow[- ]up)\b/i.test(text)) return finish([{ tool: "tasks.list", arguments: {} }], role);
    if (/\bcases?\b/i.test(text)) {
      const status = text.match(/\b(open|waiting|resolved)\b/i)?.[1]?.toLowerCase();
      const lookup = contactLookup(text);
      return finish([
        ...(lookup ? [lookup] : []),
        { tool: "cases.list", arguments: { ...(status ? { status } : {}), ...(lookup ? { contact_id: "$contact.id" } : {}) } },
      ], role);
    }
    const lookup = contactLookup(text);
    if (lookup) return finish([lookup], role);
    if (/\bcontacts?\b/i.test(text)) return finish([{ tool: "contacts.list", arguments: {} }], role);
    return blocked("Specify contacts, cases, tasks, or an explicit record ID for this read command.");
  }

  // Mutation forms consume the complete input. Do not execute an understood
  // prefix when a qualifier or additional action remains unparsed.
  const command = text;
  const isDemo = text.toLowerCase() === DEMO_UTTERANCE.toLowerCase();
  const shortDemo = text.match(/^(Maya(?: Chen)?|Jordan(?: Hale)?|Priya(?: Shah)?)'s webhook is failing\s*[—–-]\s*(?:open|file|create)\s+a\s+p[123]\s+case[.!]?$/i);
  const create = text.match(/^(?:open|file|create)\s+(?:a\s+)?(?:p[123]\s+)?case\s+for\s+(Maya(?: Chen)?|Jordan(?: Hale)?|Northwind|Priya(?: Shah)?|ct_[a-z0-9_-]+)(\s+and\s+(?:(?:create|add)\s+)?(?:a\s+)?follow[- ]up task)?[.!]?$/i);
  if (isDemo || shortDemo || create) {
    const lookup = contactLookup(isDemo ? "Maya" : shortDemo?.[1] ?? create![1]!);
    if (!lookup) return blocked("Identify exactly one demo contact by name or contact ID before opening a case.");
    const title = isDemo || shortDemo ? "Webhook retries exhausted" : "Customer-reported issue";
    const calls: PlannedCall[] = [lookup, {
      tool: "cases.create",
      arguments: { contact_id: "$contact.id", title, description: text, priority: priorityOf(text) },
    }];
    if (isDemo || create?.[2]) {
      calls.push({ tool: "tasks.create", arguments: {
        case_id: "$case.id",
        title: isDemo ? "Confirm the current signing secret is in use" : "Follow up with the customer",
      } });
    }
    return finish(calls, role);
  }

  if (/^(?:assign|resolve|close)\b/i.test(command)) {
    const tool = /^assign\b/i.test(command) ? "cases.assign" : "cases.resolve";
    if (!advertisedTools(role).includes(tool)) {
      return blocked(`Dropped ${tool} because role=${role} does not advertise it.`, [{ tool: "cases.list", arguments: { status: "open" } }], [tool]);
    }
    const assign = command.match(/^assign\s+(?:case\s+)?(cs_[a-z0-9_-]+)\s+to\s+(pr_[a-z0-9_-]+)(\s+and resolve it)?[.!]?$/i);
    const resolve = command.match(/^(?:resolve|close)\s+(?:case\s+)?(cs_[a-z0-9_-]+)(?:\s+with resolution:\s*(.{3,}))?[.!]?$/i);
    const id = assign?.[1] ?? resolve?.[1];
    if (!id) return blocked("Use an explicit case ID: assign cs_webhook to pr_supervisor, or resolve cs_webhook.");
    if (assign && !Object.values(PRINCIPALS).some((principal) => principal.id === assign[2])) {
      return blocked("Choose a known principal ID: pr_viewer, pr_operator, or pr_supervisor.");
    }
    const calls: PlannedCall[] = [{ tool: "cases.get", arguments: { case_id: id } }];
    if (assign) calls.push({ tool: "cases.assign", arguments: { case_id: "$case.id", assignee_id: assign[2] } });
    if (resolve || assign?.[3]) calls.push({ tool: "cases.resolve", arguments: {
      case_id: "$case.id", resolution_code: "done", resolution_summary: resolve?.[2] ?? "Resolved by explicit supervisor demo command.",
    } });
    return finish(calls, role);
  }

  const task = command.match(/^(?:create|add)\s+(?:a\s+)?(?:follow[- ]up\s+)?task\s+(?:for|on)\s+(?:case\s+)?(cs_[a-z0-9_-]+)\s*:\s*(.{3,})$/i);
  if (task) return finish([
    { tool: "cases.get", arguments: { case_id: task[1] } },
    { tool: "tasks.create", arguments: { case_id: "$case.id", title: task[2] } },
  ], role);
  const complete = command.match(/^(?:complete|finish)\s+(?:task\s+)?(tk_[a-z0-9_-]+)[.!]?$/i);
  if (complete) return finish([
    { tool: "tasks.get", arguments: { task_id: complete[1] } },
    { tool: "tasks.complete", arguments: { task_id: "$task.id" } },
  ], role);
  if (/^(?:pause|freeze)\b/i.test(command)) {
    const pause = command.match(/^(?:pause|freeze)\s+(?:(?:contact|account)\s+)?(Maya(?: Chen)?|Jordan(?: Hale)?|Northwind|Priya(?: Shah)?|ct_[a-z0-9_-]+)[.!]?$/i);
    const lookup = pause ? contactLookup(pause[1]!) : undefined;
    if (!lookup) return blocked("Use exactly: pause <contact name or ID>. Qualifiers and additional actions require clarification.");
    return finish([lookup, { tool: "contacts.update_status", arguments: { contact_id: "$contact.id", status: "paused" } }], role);
  }
  return blocked("Unsupported demo command. Try show cases, the supplied demo, resolve cs_webhook, or complete tk_retries.");
}

export const DEMO_UTTERANCE =
  "Maya's webhook is failing — open a P1 case and a follow-up task to confirm they are sending the current signing secret.";
