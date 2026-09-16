import { Ajv2020 } from "ajv/dist/2020.js";
import * as z from "zod/v4";
import { TOOL_NAMES } from "../auth.ts";
import type { Plan } from "./planner.ts";

export type CatalogTool = { name: string; description?: string; inputSchema?: unknown };
export const MAX_PLAN_CALLS = 16;

export class PlanValidationError extends Error {
  constructor(message: string, readonly code = "INVALID_PLAN") {
    super(message);
    this.name = "PlanValidationError";
  }
}

const planSchema = z.strictObject({
  planner: z.enum(["mock", "openai", "anthropic"]),
  rationale: z.string().max(4000),
  calls: z.array(z.strictObject({
    tool: z.enum(TOOL_NAMES),
    arguments: z.record(z.string(), z.unknown()),
  })).max(MAX_PLAN_CALLS),
  blockedReason: z.string().max(4000).optional(),
  denied: z.array(z.enum(TOOL_NAMES)).max(MAX_PLAN_CALLS).optional(),
});

const PRODUCES: Partial<Record<(typeof TOOL_NAMES)[number], string>> = {
  "contacts.list": "$contact.id", "contacts.get": "$contact.id", "contacts.update_status": "$contact.id",
  "cases.list": "$case.id", "cases.get": "$case.id", "cases.create": "$case.id", "cases.update": "$case.id",
  "cases.assign": "$case.id", "cases.resolve": "$case.id", "cases.add_internal_note": "$case.id",
  "tasks.list": "$task.id", "tasks.get": "$task.id", "tasks.create": "$task.id", "tasks.complete": "$task.id",
};
const ID_FIELDS: Record<string, string> = { contact_id: "$contact.id", case_id: "$case.id", task_id: "$task.id" };

/** Validate every call before executing any call, against the actual advertised schemas. */
export function validatePlan(value: unknown, catalog: CatalogTool[]): Plan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new PlanValidationError(`Invalid plan shape: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  const plan = parsed.data;
  if (plan.blockedReason || plan.denied?.length) return plan;
  const tools = new Map(catalog.map((tool) => [tool.name, tool]));
  const available = new Set<string>();
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat("date-time", { type: "string", validate: (text: string) => z.iso.datetime({ offset: true }).safeParse(text).success });
  for (const [index, call] of plan.calls.entries()) {
    const tool = tools.get(call.tool);
    if (!tool) throw new PlanValidationError(`Call ${index + 1}: ${call.tool} is not advertised for this role.`, "TOOL_NOT_ALLOWED");
    const schema = tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false };
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      throw new PlanValidationError(`Invalid advertised schema for ${call.tool}.`);
    }
    // Treat undeclared arguments as errors even if a host's schema omitted additionalProperties.
    const strictSchema = { ...schema, additionalProperties: false };
    const validate = ajv.compile(strictSchema);
    if (!validate(trimConstrainedStrings(call.arguments, strictSchema))) {
      throw new PlanValidationError(`Call ${index + 1} (${call.tool}): ${ajv.errorsText(validate.errors)}`);
    }
    for (const [key, argument] of Object.entries(call.arguments)) {
      if (typeof argument !== "string" || !argument.startsWith("$")) continue;
      if (!Object.hasOwn(ID_FIELDS, key) && !/^\$(?:contact|case|task)\./.test(argument)) continue;
      if (!ID_FIELDS[key] || ID_FIELDS[key] !== argument || !available.has(argument)) {
        throw new PlanValidationError(`Call ${index + 1}: ${argument} requires a preceding matching lookup or creation and the correct ID field.`, "UNBOUND_REFERENCE");
      }
    }
    const produced = PRODUCES[call.tool];
    if (produced) available.add(produced);
  }
  return plan;
}

// JSON Schema does not describe Zod's trim transform. Mirror it only for strings
// constrained by minLength, including tags, so whitespace cannot defer a failure
// until after an earlier write. The original arguments remain in the trace.
function trimConstrainedStrings(value: unknown, schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return value;
  const rule = schema as Record<string, unknown>;
  if (typeof value === "string" && typeof rule.minLength === "number") return value.trim();
  if (Array.isArray(value)) return value.map((item) => trimConstrainedStrings(item, rule.items));
  if (value && typeof value === "object") {
    const properties = (rule.properties ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimConstrainedStrings(item, properties[key])]));
  }
  return value;
}
