import { PRINCIPALS } from "./auth.ts";
import type {
  CaseRecord,
  Contact,
  InternalNote,
  Priority,
  PublicCase,
  Role,
  TaskRecord,
} from "./ontology.ts";

const now = "2026-09-14T15:00:00.000Z";

export const SEED_CONTACTS: Contact[] = [
  {
    id: "ct_maya",
    name: "Maya Chen",
    email: "maya.chen@acme-robotics.example",
    company: "Acme Robotics",
    status: "active",
    ownerTeam: "enterprise",
  },
  {
    id: "ct_jordan",
    name: "Jordan Hale",
    email: "jordan.hale@northwind.example",
    company: "Northwind Logistics",
    status: "active",
    ownerTeam: "mid-market",
  },
  {
    id: "ct_priya",
    name: PRINCIPALS.supervisor.name,
    email: PRINCIPALS.supervisor.email,
    company: "Harborline",
    status: "active",
    ownerTeam: "ops",
  },
];

const webhookNote: InternalNote = {
  id: "nt_signing",
  body: "Signing secret rotated last Tuesday. Do not mention the old key on the customer thread.",
  authorId: PRINCIPALS.supervisor.id,
  createdAt: "2026-09-12T18:10:00.000Z",
};

export const SEED_CASES: CaseRecord[] = [
  {
    id: "cs_webhook",
    contactId: "ct_maya",
    title: "Webhook retries exhausted",
    description:
      "Acme delivery endpoint returned 401 for 14 hours. Customer sees missing robot telemetry.",
    priority: "p1" satisfies Priority,
    status: "open",
    assigneeId: null,
    tags: ["webhooks", "auth"],
    internalNotes: [webhookNote],
    resolutionCode: null,
    resolutionSummary: null,
    createdAt: "2026-09-13T21:04:00.000Z",
    updatedAt: "2026-09-13T21:04:00.000Z",
  },
  {
    id: "cs_invoice",
    contactId: "ct_jordan",
    title: "Q3 invoice discrepancy",
    description: "Northwind was billed for sandbox traffic. They want a credit memo before they expand.",
    priority: "p2",
    status: "waiting",
    assigneeId: PRINCIPALS.supervisor.id,
    tags: ["billing"],
    internalNotes: [],
    resolutionCode: null,
    resolutionSummary: null,
    createdAt: "2026-09-10T16:00:00.000Z",
    updatedAt: "2026-09-11T12:20:00.000Z",
  },
  {
    id: "cs_sandbox",
    contactId: "ct_maya",
    title: "Sandbox API key rotation",
    description: "Completed key rotation for Acme's staging workspace.",
    priority: "p3",
    status: "resolved",
    assigneeId: PRINCIPALS.operator.id,
    tags: ["keys"],
    internalNotes: [],
    resolutionCode: "done",
    resolutionSummary: "New sandbox key issued; old key revoked.",
    createdAt: "2026-09-01T09:00:00.000Z",
    updatedAt: "2026-09-02T11:30:00.000Z",
  },
];

export const SEED_TASKS: TaskRecord[] = [
  {
    id: "tk_retries",
    caseId: "cs_webhook",
    title: "Confirm Acme is sending the current signing secret",
    status: "open",
    dueAt: "2026-09-15T17:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tk_credit",
    caseId: "cs_invoice",
    title: "Draft Northwind credit memo for sandbox overage",
    status: "open",
    dueAt: "2026-09-16T17:00:00.000Z",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "tk_rotate",
    caseId: "cs_sandbox",
    title: "Email Maya the sandbox rotation confirmation",
    status: "done",
    dueAt: "2026-09-02T17:00:00.000Z",
    createdAt: "2026-09-01T09:10:00.000Z",
    updatedAt: "2026-09-02T11:29:00.000Z",
  },
];

export function redactCase(record: CaseRecord, role: Role): PublicCase {
  if (role === "supervisor") {
    return { ...record, internalNotes: [...record.internalNotes] };
  }
  const { internalNotes, ...rest } = record;
  return {
    ...rest,
    hiddenInternalNoteCount: internalNotes.length,
  };
}
