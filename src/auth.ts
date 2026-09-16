import type { Principal, Role } from "./ontology.ts";

export const ROLES = ["viewer", "operator", "supervisor"] as const;

export const TOOL_NAMES = [
  "whoami",
  "contacts.list",
  "contacts.get",
  "contacts.update_status",
  "cases.list",
  "cases.get",
  "cases.create",
  "cases.update",
  "cases.assign",
  "cases.resolve",
  "cases.add_internal_note",
  "tasks.list",
  "tasks.get",
  "tasks.create",
  "tasks.complete",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

const TOOL_ROLES: Record<ToolName, readonly Role[]> = {
  whoami: ["viewer", "operator", "supervisor"],
  "contacts.list": ["viewer", "operator", "supervisor"],
  "contacts.get": ["viewer", "operator", "supervisor"],
  "contacts.update_status": ["supervisor"],
  "cases.list": ["viewer", "operator", "supervisor"],
  "cases.get": ["viewer", "operator", "supervisor"],
  "cases.create": ["operator", "supervisor"],
  "cases.update": ["operator", "supervisor"],
  "cases.assign": ["supervisor"],
  "cases.resolve": ["supervisor"],
  "cases.add_internal_note": ["supervisor"],
  "tasks.list": ["viewer", "operator", "supervisor"],
  "tasks.get": ["viewer", "operator", "supervisor"],
  "tasks.create": ["operator", "supervisor"],
  "tasks.complete": ["operator", "supervisor"],
};

export const PRINCIPALS: Record<Role, Principal> = {
  viewer: {
    id: "pr_viewer",
    name: "Sam Ortiz",
    email: "sam.ortiz@harborline.example",
    role: "viewer",
  },
  operator: {
    id: "pr_operator",
    name: "Alex Rivera",
    email: "alex.rivera@harborline.example",
    role: "operator",
  },
  supervisor: {
    id: "pr_supervisor",
    name: "Priya Shah",
    email: "priya.shah@harborline.example",
    role: "supervisor",
  },
};

export class InvalidRoleError extends Error {
  readonly code = "VALIDATION" as const;
  constructor() {
    super("role must be viewer, operator, or supervisor");
    this.name = "InvalidRoleError";
  }
}

export function parseRole(value: unknown, fallback: Role = "operator"): Role {
  if (value === undefined || value === null) return fallback;
  if (value === "viewer" || value === "operator" || value === "supervisor") {
    return value;
  }
  throw new InvalidRoleError();
}

export function advertisedTools(role: Role): ToolName[] {
  return TOOL_NAMES.filter((name) => TOOL_ROLES[name].includes(role));
}

export function can(role: Role, tool: ToolName): boolean {
  return TOOL_ROLES[tool].includes(role);
}

export function assertCan(role: Role, tool: ToolName): void {
  if (!can(role, tool)) {
    throw new PermissionError(tool, role);
  }
}

export class PermissionError extends Error {
  readonly code = "PERMISSION_DENIED" as const;
  constructor(
    readonly tool: ToolName,
    readonly role: Role,
  ) {
    super(`${role} cannot call ${tool}`);
    this.name = "PermissionError";
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case "viewer":
      return "Viewer — read the desk, change nothing";
    case "operator":
      return "Operator — open cases and tasks, no assignment or resolve";
    case "supervisor":
      return "Supervisor — assign, resolve, internal notes, account status";
  }
}
