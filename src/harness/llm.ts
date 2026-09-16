import type { Role } from "../ontology.ts";
import type { Plan, PlannedCall } from "./planner.ts";

export type LlmProvider = "openai" | "anthropic";

type CatalogTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export async function planWithLlm(options: {
  provider: LlmProvider;
  utterance: string;
  role: Role;
  tools: CatalogTool[];
}): Promise<Plan> {
  const system = [
    `You are an ops agent on the Harborline desk. Connected role: ${options.role}.`,
    "Return ONLY a JSON object { rationale: string, calls: [{ tool: string, arguments: object }] }.",
    "Use only tools from the provided catalog. Prefer contacts.list before create when the user names a person.",
    "Use placeholder strings $contact.id, $case.id, $task.id when a later call needs an id from an earlier result.",
    "Never invent numeric or UUID ids.",
  ].join(" ");

  const catalog = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  const user = JSON.stringify({ utterance: options.utterance, catalog }, null, 2);
  const raw = options.provider === "openai" ? await callOpenAi(system, user) : await callAnthropic(system, user);
  const parsed = extractJson(raw) as { rationale?: string; calls?: PlannedCall[] };

  return {
    planner: options.provider,
    rationale: parsed.rationale ?? "LLM plan",
    calls: Array.isArray(parsed.calls) ? parsed.calls : [],
  };
}

async function callOpenAi(system: string, user: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { choices: Array<{ message: { content: string } }> };
  return body.choices[0]?.message.content ?? "{}";
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as { content: Array<{ type: string; text?: string }> };
  return body.content.find((block) => block.type === "text")?.text ?? "{}";
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const text = fenced?.[1] ?? raw;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) return {};
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export function detectProvider(): LlmProvider | "mock" {
  const configured = process.env.WAYLUCID_LLM?.toLowerCase();
  if (configured === "openai" || configured === "anthropic" || configured === "mock") {
    return configured;
  }
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}
