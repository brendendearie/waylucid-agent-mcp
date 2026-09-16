import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { advertisedTools, can, PRINCIPALS } from "../auth.ts";
import type { Role } from "../ontology.ts";
import { CASE_STATUSES, CONTACT_STATUSES, PRIORITIES, TASK_STATUSES } from "../ontology.ts";
import { ConflictError, NotFoundError, dueAtSchema, type OpsStore } from "../store.ts";
import { fail, fromUnknown, ok } from "./result.ts";

const prioritySchema = z.enum(PRIORITIES);
const caseStatusSchema = z.enum(CASE_STATUSES);
const taskStatusSchema = z.enum(TASK_STATUSES);
const contactStatusSchema = z.enum(CONTACT_STATUSES);

function operatorCaseUpdateSchema() {
  return z.strictObject({
    case_id: z.string().describe("Case id, for example cs_webhook"),
    title: z.string().trim().min(3).max(10_000).optional(),
    description: z.string().trim().min(3).max(10_000).optional(),
    priority: prioritySchema.optional(),
  });
}

function supervisorCaseUpdateSchema() {
  return operatorCaseUpdateSchema().extend({
    tags: z.array(z.string().trim().min(1).max(64)).max(20).optional().describe("Replace the case tag list"),
  });
}

export function registerTools(server: McpServer, store: OpsStore, role: Role): void {
  const tools = advertisedTools(role);

  if (tools.includes("whoami")) {
    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description:
          "Return the connected Harborline principal, role, and the tool names this role may call.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({}),
        outputSchema: z.strictObject({
          ok: z.literal(true),
          data: z.strictObject({
            principal: z.strictObject({
              id: z.string(),
              name: z.string(),
              email: z.string(),
              role: z.enum(["viewer", "operator", "supervisor"]),
            }),
            advertised_tools: z.array(z.string()),
            notes: z.array(z.string()),
          }),
        }),
      },
      async () =>
        ok({
          principal: PRINCIPALS[role],
          advertised_tools: advertisedTools(role),
          notes: [
            "Tool schemas are narrowed to this role. Unknown input fields are rejected before mutation.",
            "Disallowed tools are not registered, so direct calls are rejected too.",
            "Internal notes on cases are only present for supervisors.",
          ],
        }),
    );
  }

  if (tools.includes("contacts.list")) {
    server.registerTool(
      "contacts.list",
      {
        title: "List contacts",
        description: "Search Harborline contacts by name, email, company, or id.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          query: z.string().optional().describe("Optional substring match"),
        }),
      },
      async ({ query }) => ok({ contacts: store.listContacts(query) }),
    );
  }

  if (tools.includes("contacts.get")) {
    server.registerTool(
      "contacts.get",
      {
        title: "Get contact",
        description: "Fetch one contact by id.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          contact_id: z.string(),
        }),
      },
      async ({ contact_id }) => {
        try {
          return ok({ contact: store.getContact(contact_id) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("contacts.update_status")) {
    server.registerTool(
      "contacts.update_status",
      {
        title: "Update contact status",
        description:
          "Pause or reactivate a contact. Supervisor only. Operators cannot freeze an account from the tool catalog.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.strictObject({
          contact_id: z.string(),
          status: contactStatusSchema,
        }),
      },
      async ({ contact_id, status }) => {
        try {
          return ok({ contact: store.updateContactStatus(contact_id, status) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("cases.list")) {
    server.registerTool(
      "cases.list",
      {
        title: "List cases",
        description: "List ops cases, optionally filtered by status or contact.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          status: caseStatusSchema.optional(),
          contact_id: z.string().optional(),
        }),
      },
      async ({ status, contact_id }) =>
        ok({
          cases: store.listCases({ status, contactId: contact_id }).map((row) => store.presentCase(row.id, role)),
        }),
    );
  }

  if (tools.includes("cases.get")) {
    server.registerTool(
      "cases.get",
      {
        title: "Get case",
        description:
          "Fetch one case. Supervisors see internal notes. Other roles receive hiddenInternalNoteCount instead of the note bodies.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          case_id: z.string(),
        }),
      },
      async ({ case_id }) => {
        try {
          return ok({ case: store.presentCase(case_id, role) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("cases.create")) {
    server.registerTool(
      "cases.create",
      {
        title: "Create case",
        description: "Open a new case on a contact. Starts as open, unassigned.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: z.strictObject({
          contact_id: z.string(),
          title: z.string().trim().min(3).max(10_000),
          description: z.string().trim().min(3).max(10_000),
          priority: prioritySchema.default("p2"),
        }),
      },
      async ({ contact_id, title, description, priority }) => {
        try {
          const created = store.createCase({
            contactId: contact_id,
            title,
            description,
            priority,
          });
          return ok({ case: store.presentCase(created.id, role) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("cases.update")) {
    if (role === "supervisor") {
      server.registerTool(
        "cases.update",
        {
          title: "Update case",
          description: "Update case fields including tags. Assignment and resolve are separate tools.",
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
          inputSchema: supervisorCaseUpdateSchema(),
        },
        async ({ case_id, title, description, priority, tags }) => {
          try {
            const updated = store.updateCase(case_id, { title, description, priority, tags });
            return ok({ case: store.presentCase(updated.id, role) });
          } catch (error) {
            return fromUnknown(error);
          }
        },
      );
    } else {
      server.registerTool(
        "cases.update",
        {
          title: "Update case",
          description: "Update title, description, or priority. This role cannot set tags, assignee, or resolution.",
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
          inputSchema: operatorCaseUpdateSchema(),
        },
        async ({ case_id, title, description, priority }) => {
          try {
            const updated = store.updateCase(case_id, { title, description, priority });
            return ok({ case: store.presentCase(updated.id, role) });
          } catch (error) {
            return fromUnknown(error);
          }
        },
      );
    }
  }

  if (tools.includes("cases.assign")) {
    server.registerTool(
      "cases.assign",
      {
        title: "Assign case",
        description: "Set the case assignee. Supervisor only. Resolved cases cannot be reassigned.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.strictObject({
          case_id: z.string(),
          assignee_id: z.string().describe("Principal id such as pr_supervisor or pr_operator"),
        }),
      },
      async ({ case_id, assignee_id }) => {
        try {
          const updated = store.assignCase(case_id, assignee_id);
          return ok({ case: store.presentCase(updated.id, role) });
        } catch (error) {
          if (error instanceof ConflictError) return fail("CONFLICT", error.message);
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("cases.resolve")) {
    server.registerTool(
      "cases.resolve",
      {
        title: "Resolve case",
        description: "Close a case with a resolution code and customer-safe summary. Supervisor only.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.strictObject({
          case_id: z.string(),
          resolution_code: z.string().min(2),
          resolution_summary: z.string().trim().min(3).max(10_000),
        }),
      },
      async ({ case_id, resolution_code, resolution_summary }) => {
        try {
          const updated = store.resolveCase(case_id, resolution_code, resolution_summary);
          return ok({ case: store.presentCase(updated.id, role) });
        } catch (error) {
          if (error instanceof ConflictError) return fail("CONFLICT", error.message);
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("cases.add_internal_note")) {
    server.registerTool(
      "cases.add_internal_note",
      {
        title: "Add internal note",
        description:
          "Attach a note that must not be shown to the customer. Supervisor only. Operators reading the case will only see a hidden-note count.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: z.strictObject({
          case_id: z.string(),
          body: z.string().trim().min(3).max(10_000),
        }),
      },
      async ({ case_id, body }) => {
        try {
          const updated = store.addInternalNote(case_id, body, PRINCIPALS[role].id);
          return ok({ case: store.presentCase(updated.id, role) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("tasks.list")) {
    server.registerTool(
      "tasks.list",
      {
        title: "List tasks",
        description: "List follow-up tasks, optionally filtered by status or case.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          status: taskStatusSchema.optional(),
          case_id: z.string().optional(),
        }),
      },
      async ({ status, case_id }) => ok({ tasks: store.listTasks({ status, caseId: case_id }) }),
    );
  }

  if (tools.includes("tasks.get")) {
    server.registerTool(
      "tasks.get",
      {
        title: "Get task",
        description: "Fetch one task by id.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.strictObject({
          task_id: z.string(),
        }),
      },
      async ({ task_id }) => {
        try {
          return ok({ task: store.getTask(task_id) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("tasks.create")) {
    server.registerTool(
      "tasks.create",
      {
        title: "Create task",
        description: "Create a follow-up task on an existing case.",
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: z.strictObject({
          case_id: z.string(),
          title: z.string().trim().min(3).max(10_000),
          due_at: dueAtSchema.optional().describe("ISO-8601 timestamp with a timezone"),
        }),
      },
      async ({ case_id, title, due_at }) => {
        try {
          return ok({ task: store.createTask({ caseId: case_id, title, dueAt: due_at }) });
        } catch (error) {
          return fromUnknown(error);
        }
      },
    );
  }

  if (tools.includes("tasks.complete")) {
    server.registerTool(
      "tasks.complete",
      {
        title: "Complete task",
        description: "Mark a task done.",
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.strictObject({
          task_id: z.string(),
        }),
      },
      async ({ task_id }) => {
        try {
          return ok({ task: store.completeTask(task_id) });
        } catch (error) {
          if (error instanceof ConflictError) return fail("CONFLICT", error.message);
          if (error instanceof NotFoundError) return fail("NOT_FOUND", error.message);
          return fromUnknown(error);
        }
      },
    );
  }

  for (const name of tools) {
    if (!can(role, name)) {
      throw new Error(`refusing to advertise ${name} to ${role}`);
    }
  }
}
