import { redactCase, SEED_CASES, SEED_CONTACTS, SEED_TASKS } from "./seed.ts";
import type {
  CaseRecord,
  CaseStatus,
  Contact,
  ContactStatus,
  DeskSnapshot,
  Priority,
  PublicCase,
  Role,
  TaskRecord,
  TaskStatus,
} from "./ontology.ts";

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  constructor(kind: string, id: string) {
    super(`${kind} ${id} not found`);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export type CreateCaseInput = {
  contactId: string;
  title: string;
  description: string;
  priority: Priority;
};

export type UpdateCaseInput = {
  title?: string;
  description?: string;
  priority?: Priority;
  tags?: string[];
};

export type CreateTaskInput = {
  caseId: string;
  title: string;
  dueAt?: string | null;
};

function cloneContact(c: Contact): Contact {
  return { ...c };
}

function cloneCase(c: CaseRecord): CaseRecord {
  return {
    ...c,
    tags: [...c.tags],
    internalNotes: c.internalNotes.map((n) => ({ ...n })),
  };
}

function cloneTask(t: TaskRecord): TaskRecord {
  return { ...t };
}

function matchesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

export class OpsStore {
  private contacts = new Map<string, Contact>();
  private cases = new Map<string, CaseRecord>();
  private tasks = new Map<string, TaskRecord>();
  private seq = 100;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.contacts = new Map(SEED_CONTACTS.map((c) => [c.id, cloneContact(c)]));
    this.cases = new Map(SEED_CASES.map((c) => [c.id, cloneCase(c)]));
    this.tasks = new Map(SEED_TASKS.map((t) => [t.id, cloneTask(t)]));
    this.seq = 100;
  }

  private next(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  private stamp(): string {
    return new Date().toISOString();
  }

  listContacts(query?: string): Contact[] {
    const rows = [...this.contacts.values()].map(cloneContact);
    if (!query?.trim()) return rows;
    return rows.filter(
      (c) =>
        matchesQuery(c.name, query) ||
        matchesQuery(c.email, query) ||
        matchesQuery(c.company, query) ||
        matchesQuery(c.id, query),
    );
  }

  getContact(id: string): Contact {
    const row = this.contacts.get(id);
    if (!row) throw new NotFoundError("contact", id);
    return cloneContact(row);
  }

  updateContactStatus(id: string, status: ContactStatus): Contact {
    const row = this.contacts.get(id);
    if (!row) throw new NotFoundError("contact", id);
    row.status = status;
    return cloneContact(row);
  }

  listCases(filter?: { status?: CaseStatus; contactId?: string }): CaseRecord[] {
    return [...this.cases.values()]
      .filter((row) => (filter?.status ? row.status === filter.status : true))
      .filter((row) => (filter?.contactId ? row.contactId === filter.contactId : true))
      .map(cloneCase);
  }

  getCase(id: string): CaseRecord {
    const row = this.cases.get(id);
    if (!row) throw new NotFoundError("case", id);
    return cloneCase(row);
  }

  createCase(input: CreateCaseInput): CaseRecord {
    this.getContact(input.contactId);
    const createdAt = this.stamp();
    const row: CaseRecord = {
      id: this.next("cs"),
      contactId: input.contactId,
      title: input.title,
      description: input.description,
      priority: input.priority,
      status: "open",
      assigneeId: null,
      tags: [],
      internalNotes: [],
      resolutionCode: null,
      resolutionSummary: null,
      createdAt,
      updatedAt: createdAt,
    };
    this.cases.set(row.id, row);
    return cloneCase(row);
  }

  updateCase(id: string, patch: UpdateCaseInput): CaseRecord {
    const row = this.cases.get(id);
    if (!row) throw new NotFoundError("case", id);
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.priority !== undefined) row.priority = patch.priority;
    if (patch.tags !== undefined) row.tags = [...patch.tags];
    row.updatedAt = this.stamp();
    return cloneCase(row);
  }

  assignCase(id: string, assigneeId: string): CaseRecord {
    const row = this.cases.get(id);
    if (!row) throw new NotFoundError("case", id);
    if (row.status === "resolved") {
      throw new ConflictError("resolved cases cannot be reassigned");
    }
    row.assigneeId = assigneeId;
    row.updatedAt = this.stamp();
    return cloneCase(row);
  }

  resolveCase(id: string, resolutionCode: string, resolutionSummary: string): CaseRecord {
    const row = this.cases.get(id);
    if (!row) throw new NotFoundError("case", id);
    if (row.status === "resolved") {
      throw new ConflictError("case is already resolved");
    }
    row.status = "resolved";
    row.resolutionCode = resolutionCode;
    row.resolutionSummary = resolutionSummary;
    row.updatedAt = this.stamp();
    return cloneCase(row);
  }

  addInternalNote(id: string, body: string, authorId: string): CaseRecord {
    const row = this.cases.get(id);
    if (!row) throw new NotFoundError("case", id);
    row.internalNotes.push({
      id: this.next("nt"),
      body,
      authorId,
      createdAt: this.stamp(),
    });
    row.updatedAt = this.stamp();
    return cloneCase(row);
  }

  listTasks(filter?: { status?: TaskStatus; caseId?: string }): TaskRecord[] {
    return [...this.tasks.values()]
      .filter((row) => (filter?.status ? row.status === filter.status : true))
      .filter((row) => (filter?.caseId ? row.caseId === filter.caseId : true))
      .map(cloneTask);
  }

  getTask(id: string): TaskRecord {
    const row = this.tasks.get(id);
    if (!row) throw new NotFoundError("task", id);
    return cloneTask(row);
  }

  createTask(input: CreateTaskInput): TaskRecord {
    this.getCase(input.caseId);
    const createdAt = this.stamp();
    const row: TaskRecord = {
      id: this.next("tk"),
      caseId: input.caseId,
      title: input.title,
      status: "open",
      dueAt: input.dueAt ?? null,
      createdAt,
      updatedAt: createdAt,
    };
    this.tasks.set(row.id, row);
    return cloneTask(row);
  }

  completeTask(id: string): TaskRecord {
    const row = this.tasks.get(id);
    if (!row) throw new NotFoundError("task", id);
    if (row.status === "done") {
      throw new ConflictError("task is already done");
    }
    row.status = "done";
    row.updatedAt = this.stamp();
    return cloneTask(row);
  }

  presentCase(id: string, role: Role): PublicCase {
    return redactCase(this.getCase(id), role);
  }

  snapshot(role: Role): DeskSnapshot {
    return {
      contacts: this.listContacts(),
      cases: this.listCases().map((row) => redactCase(row, role)),
      tasks: this.listTasks(),
    };
  }
}

export const desk = new OpsStore();
