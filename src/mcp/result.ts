import type { ToolErr, ToolErrorCode, ToolResult } from "../ontology.ts";

export function ok<T>(data: T): { content: [{ type: "text"; text: string }]; structuredContent: ToolResult<T> } {
  const structuredContent: ToolResult<T> = { ok: true, data };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function fail(
  code: ToolErrorCode,
  message: string,
): {
  isError: true;
  content: [{ type: "text"; text: string }];
  structuredContent: ToolErr;
} {
  const structuredContent: ToolErr = { ok: false, error: { code, message } };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function fromUnknown(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const code = String((error as { code: unknown }).code);
    const message = String((error as { message: unknown }).message);
    if (code === "PERMISSION_DENIED" || code === "NOT_FOUND" || code === "VALIDATION" || code === "CONFLICT") {
      return fail(code, message);
    }
  }
  const message = error instanceof Error ? error.message : "unknown error";
  return fail("VALIDATION", message);
}
