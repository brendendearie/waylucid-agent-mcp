export const PRIORITIES = ["p1", "p2", "p3"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CASE_STATUSES = ["open", "waiting", "resolved"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const TASK_STATUSES = ["open", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const CONTACT_STATUSES = ["active", "paused"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export type Contact = {
  id: string;
  name: string;
  email: string;
  company: string;
  status: ContactStatus;
  ownerTeam: string;
};

export type CaseRecord = {
  id: string;
  contactId: string;
  title: string;
  description: string;
  priority: Priority;
  status: CaseStatus;
  assigneeId: string | null;
  tags: string[];
  internalNotes: InternalNote[];
  resolutionCode: string | null;
  resolutionSummary: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InternalNote = {
  id: string;
  body: string;
  authorId: string;
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  caseId: string;
  title: string;
  status: TaskStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Principal = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type Role = "viewer" | "operator" | "supervisor";

export type DeskSnapshot = {
  contacts: Contact[];
  cases: PublicCase[];
  tasks: TaskRecord[];
};

export type PublicCase = Omit<CaseRecord, "internalNotes"> & {
  internalNotes?: InternalNote[];
  hiddenInternalNoteCount?: number;
};

export type ToolErrorCode =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT";

export type ToolOk<T> = { ok: true; data: T };
export type ToolErr = {
  ok: false;
  error: { code: ToolErrorCode; message: string };
};
export type ToolResult<T> = ToolOk<T> | ToolErr;
