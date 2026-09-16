import { describe, expect, it } from "vitest";
import { ConflictError, OpsStore } from "../src/store.ts";

describe("OpsStore", () => {
  it("seeds a coherent desk", () => {
    const store = new OpsStore();
    expect(store.listContacts()).toHaveLength(3);
    expect(store.listCases({ status: "open" }).map((row) => row.id)).toEqual(["cs_webhook"]);
    expect(store.getContact("ct_maya").company).toBe("Acme Robotics");
  });

  it("opens a case and a task against a real contact", () => {
    const store = new OpsStore();
    const created = store.createCase({
      contactId: "ct_jordan",
      title: "Sandbox overage follow-up",
      description: "Confirm they want the credit applied to October.",
      priority: "p2",
    });
    expect(created.status).toBe("open");
    const task = store.createTask({ caseId: created.id, title: "Send the credit memo draft" });
    expect(task.caseId).toBe(created.id);
    store.completeTask(task.id);
    expect(store.getTask(task.id).status).toBe("done");
  });

  it("refuses to complete a task twice", () => {
    const store = new OpsStore();
    expect(() => store.completeTask("tk_rotate")).toThrow(ConflictError);
  });

  it("redacts internal notes for operators", () => {
    const store = new OpsStore();
    const operatorView = store.presentCase("cs_webhook", "operator");
    const supervisorView = store.presentCase("cs_webhook", "supervisor");
    expect(operatorView.internalNotes).toBeUndefined();
    expect(operatorView.hiddenInternalNoteCount).toBe(1);
    expect(supervisorView.internalNotes?.[0]?.body).toMatch(/Signing secret/);
  });
});
