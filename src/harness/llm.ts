import * as z from "zod/v4";
import type { Role } from "../ontology.ts";
import type { Plan } from "./planner.ts";
import { MAX_PLAN_CALLS, PlanValidationError, validatePlan, type CatalogTool } from "./validation.ts";

export type LlmProvider = "openai" | "anthropic";
export const DEFAULT_MODEL_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARS = 128_000;

export async function planWithLlm(options: {
  provider: LlmProvider;
  utterance: string;
  role: Role;
  tools: CatalogTool[];
  timeoutMs?: number;
}): Promise<Plan> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new Error("Model timeout must be between 1 and 60000 ms.");
  const system = [
    `You are an ops agent on the fictional Harborline desk. Connected role: ${options.role}.`,
    `Return ONLY a JSON object { rationale: string, calls: [{ tool: string, arguments: object }] } with at most ${MAX_PLAN_CALLS} calls.`,
    "Use only the provided catalog and exact argument schemas. A read or negated request must never produce writes.",
    "Plan only actions explicitly requested. Return an empty calls array and explain the clarification needed when intent or target is ambiguous.",
    "Use contacts.list/get, cases.list/get, or tasks.list/get before writing existing records. A list must return exactly one match to bind an ID.",
    "Use $contact.id, $case.id, $task.id only as the complete value of the corresponding ID argument, after a matching lookup or creation.",
    "Do not invent IDs, names, resolution claims, or note bodies. No tool results are available during this one-shot planning step.",
  ].join(" ");
  const user = JSON.stringify({ utterance: options.utterance, catalog: options.tools }, null, 2);
  const raw = options.provider === "openai" ? await callOpenAi(system, user, timeoutMs) : await callAnthropic(system, user, timeoutMs);
  const parsed = extractJson(raw);
  return validatePlan({ ...parsed, planner: options.provider }, options.tools);
}

async function requestJson(url: string, init: RequestInit, label: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${label} request failed (HTTP ${response.status}).`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error(`${label} response exceeded the size limit.`);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${label} request timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAi(system: string, user: string, timeoutMs: number): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const response = await requestJson("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini", temperature: 0, max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  }, "OpenAI", timeoutMs);
  const body = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) }).safeParse(response);
  if (!body.success) throw new PlanValidationError("OpenAI returned an invalid message envelope.");
  return body.data.choices[0]!.message.content;
}

async function callAnthropic(system: string, user: string, timeoutMs: number): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const response = await requestJson("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514", max_tokens: 4096,
      system, messages: [{ role: "user", content: user }],
    }),
  }, "Anthropic", timeoutMs);
  const body = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })).min(1) }).safeParse(response);
  if (!body.success) throw new PlanValidationError("Anthropic returned an invalid message envelope.");
  const text = body.data.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
  if (!text) throw new PlanValidationError("Anthropic returned no text plan.");
  return text;
}

function extractJson(raw: string): Record<string, unknown> {
  if (raw.length > MAX_RESPONSE_CHARS) throw new PlanValidationError("The model plan exceeded the size limit.");
  const text = raw.trim().replace(/^```json\s*([\s\S]*?)\s*```$/i, "$1");
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new PlanValidationError("The model did not return a valid JSON plan."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlanValidationError("The model plan must be an object.");
  return value as Record<string, unknown>;
}

/** Paid model requests require an explicit provider choice, never just an ambient API key. */
export function detectProvider(): LlmProvider | "mock" {
  const configured = process.env.WAYLUCID_LLM?.trim().toLowerCase();
  if (!configured || configured === "mock") return "mock";
  if (configured === "openai" || configured === "anthropic") return configured;
  throw new Error("WAYLUCID_LLM must be mock, openai, or anthropic.");
}
