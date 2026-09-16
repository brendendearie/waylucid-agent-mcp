import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

type Role = "viewer" | "operator" | "supervisor";

type Tool = {
  name: string;
  title?: string;
  description?: string;
  annotations?: Record<string, unknown>;
  inputSchema?: unknown;
};

type Catalog = {
  role: Role;
  principal: { id: string; name: string; email: string; role: Role };
  label: string;
  tools: Tool[];
};

type Desk = {
  contacts: Array<{ id: string; name: string; company: string; status: string }>;
  cases: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    contactId: string;
    hiddenInternalNoteCount?: number;
    internalNotes?: unknown[];
  }>;
  tasks: Array<{ id: string; title: string; status: string; caseId: string }>;
};

type Trace = {
  utterance: string;
  role: Role;
  plan: { planner: string; rationale: string; calls: Array<{ tool: string }> };
  steps: Array<{
    name: string;
    arguments: Record<string, unknown>;
    isError?: boolean;
    text: string;
  }>;
  denied: string[];
  outcome: "completed" | "blocked" | "failed";
  issue?: { code: string; message: string };
};

type EvalReport = {
  passed: number;
  failed: number;
  results: Array<{ id: string; title: string; pass: boolean }>;
};

const ROLES: Role[] = ["viewer", "operator", "supervisor"];
const DEMO =
  "Maya's webhook is failing — open a P1 case and a follow-up task to confirm they are sending the current signing secret.";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export default function App() {
  const [role, setRole] = useState<Role>("operator");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [utterance, setUtterance] = useState(DEMO);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [evalReport, setEvalReport] = useState<EvalReport | null>(null);
  const [busy, setBusy] = useState<"catalog" | "run" | "eval" | "reset" | null>("catalog");
  const [error, setError] = useState<string | null>(null);

  const loadDesk = useCallback(async (nextRole: Role) => {
    setBusy("catalog");
    setError(null);
    try {
      const [nextCatalog, nextDesk] = await Promise.all([
        getJson<Catalog>(`/api/catalog?role=${nextRole}`),
        getJson<{ desk: Desk }>(`/api/desk?role=${nextRole}`),
      ]);
      setCatalog(nextCatalog);
      setDesk(nextDesk.desk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the desk");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void loadDesk(role);
  }, [role, loadDesk]);

  const run = async () => {
    setBusy("run");
    setError(null);
    try {
      const body = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ utterance, role }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(`agent failed (${response.status})`);
        return (await response.json()) as { trace: Trace; desk: Desk };
      });
      setTrace(body.trace);
      setDesk(body.desk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent run failed");
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    setError(null);
    setTrace(null);
    try {
      const body = await fetch(`/api/reset?role=${role}`, { method: "POST" }).then(async (response) => {
        if (!response.ok) throw new Error("reset failed");
        return (await response.json()) as { desk: Desk };
      });
      setDesk(body.desk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(null);
    }
  };

  const runEval = async () => {
    setBusy("eval");
    setError(null);
    try {
      setEvalReport(await getJson<EvalReport>("/api/eval"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval failed");
    } finally {
      setBusy(null);
    }
  };

  const writes = useMemo(
    () => catalog?.tools.filter((tool) => tool.annotations?.readOnlyHint !== true) ?? [],
    [catalog],
  );

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono text-[11px] tracking-[0.28em] text-amber uppercase">WayLucid · Harborline</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Harborline ops desk</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-mute">
            Permission-aware MCP tools for contacts, cases, and tasks. Inspect the contract, run a plan, and see
            where execution stops. Fictional data · local role simulator · no authentication.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ROLES.map((value) => (
            <button
              key={value}
              type="button"
              disabled={busy !== null}
              aria-pressed={role === value}
              onClick={() => {
                if (value === role) return;
                setBusy("catalog");
                setCatalog(null);
                setDesk(null);
                setTrace(null);
                setRole(value);
              }}
              className={`rounded-full border px-3 py-1.5 font-mono text-xs capitalize ${
                role === value
                  ? "border-amber bg-amber/15 text-amber"
                  : "border-line bg-panel text-mute hover:border-mute"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose/40 bg-rose/10 px-4 py-3 text-sm text-rose">{error}</div>
      ) : null}

      <section className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <Panel title="Advertised tools" kicker={catalog ? `${catalog.tools.length} for ${role}` : "loading"}>
          {busy === "catalog" && !catalog ? (
            <p className="text-sm text-mute">Loading catalog…</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {catalog?.tools.map((tool) => (
                <li key={tool.name} className="rounded-lg border border-line bg-panel-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[13px] text-paper">{tool.name}</span>
                    <Hint annotations={tool.annotations} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-mute">{tool.description}</p>
                  <details className="mt-2 text-xs text-mute">
                    <summary className="cursor-pointer font-mono">Input contract</summary>
                    <pre className="mt-2 max-h-52 overflow-auto text-[11px]">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {writes.length > 0 ? (
            <p className="mt-3 font-mono text-[11px] text-mute">{writes.length} write tools visible to this role</p>
          ) : (
            <p className="mt-3 font-mono text-[11px] text-mute">Read-only catalog — no writes advertised</p>
          )}
        </Panel>

        <Panel title="Agent harness" kicker="deterministic demo grammar">
          <label htmlFor="utterance" className="mb-2 block font-mono text-[11px] tracking-wide text-mute uppercase">Utterance</label>
          <textarea
            id="utterance"
            value={utterance}
            onChange={(event) => setUtterance(event.target.value)}
            rows={4}
            className="w-full resize-y rounded-lg border border-line bg-ink px-3 py-2 text-sm leading-6 text-paper outline-none focus:border-amber"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy !== null}
              className="rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              {busy === "run" ? "Running…" : "Run tool path"}
            </button>
            <button
              type="button"
              onClick={() => setUtterance(DEMO)}
              disabled={busy !== null}
              className="rounded-lg border border-line px-3 py-2 text-sm text-paper hover:border-mute"
            >
              Load demo
            </button>
            <button
              type="button"
              onClick={() => setUtterance("list follow-up tasks")}
              disabled={busy !== null}
              className="rounded-lg border border-line px-3 py-2 text-sm text-paper hover:border-mute"
            >
              Read-only probe
            </button>
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy !== null || role !== "supervisor"}
              title={role !== "supervisor" ? "Select supervisor to reset the fictional desk" : "Reset fictional seed data"}
              className="rounded-lg border border-line px-3 py-2 text-sm text-mute hover:border-mute"
            >
              Reset seed (supervisor)
            </button>
          </div>

          {!trace ? (
            <Empty
              title="No transcript yet"
              body="Run as operator to create a case and follow-up. Switch to viewer to see the same workflow blocked. The read-only probe must never create a task."
            />
          ) : (
            <div className="mt-4 space-y-3">
              <div role="status" className={`rounded-lg border px-3 py-2 ${trace.outcome === "completed" ? "border-mint/30 text-mint" : "border-rose/30 text-rose"}`}>
                <p className="font-mono text-xs uppercase">{trace.outcome} · {trace.steps.length} executed / {trace.plan.calls.length} planned</p>
                {trace.issue ? <p className="mt-1 text-xs leading-5">{trace.issue.code}: {trace.issue.message}</p> : null}
              </div>
              <p className="text-sm leading-6 text-mute">{trace.plan.rationale}</p>
              {trace.denied.length > 0 ? (
                <p className="font-mono text-xs text-rose">Denied (not advertised): {trace.denied.join(", ")}</p>
              ) : null}
              <ol className="space-y-2">
                {trace.steps.map((step, index) => (
                  <li key={`${step.name}-${index}`} className="rounded-lg border border-line bg-ink px-3 py-2">
                    <div className="flex items-center justify-between gap-2 font-mono text-xs">
                      <span>
                        {index + 1}. {step.name}
                      </span>
                      <span className={step.isError ? "text-rose" : "text-mint"}>{step.isError ? "error" : "ok"}</span>
                    </div>
                    <pre className="mt-2 max-h-40 overflow-auto text-[11px] leading-5 text-mute">{step.text}</pre>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Desk snapshot" kicker={catalog?.principal.name ?? "—"}>
            {!desk ? (
              <p className="text-sm text-mute">Loading seed data…</p>
            ) : (
              <div className="space-y-4 text-sm">
                <Group title="Contacts">
                  {desk.contacts.map((contact) => (
                    <li key={contact.id} className="flex justify-between gap-2">
                      <span>
                        {contact.name}
                        <span className="block font-mono text-[11px] text-mute">{contact.company}</span>
                      </span>
                      <span className="font-mono text-[11px] text-mute">{contact.status}</span>
                    </li>
                  ))}
                </Group>
                <Group title="Cases">
                  {desk.cases.map((row) => (
                    <li key={row.id} className="flex justify-between gap-2">
                      <span>
                        {row.title}
                        <span className="block font-mono text-[11px] text-mute">
                          {row.id} · {row.priority}
                          {row.hiddenInternalNoteCount
                            ? ` · ${row.hiddenInternalNoteCount} hidden note${row.hiddenInternalNoteCount === 1 ? "" : "s"}`
                            : row.internalNotes
                              ? ` · ${row.internalNotes.length} internal`
                              : ""}
                        </span>
                      </span>
                      <span className="font-mono text-[11px] capitalize text-mute">{row.status}</span>
                    </li>
                  ))}
                </Group>
                <Group title="Tasks">
                  {desk.tasks.map((task) => (
                    <li key={task.id} className="flex justify-between gap-2">
                      <span>{task.title}</span>
                      <span className="font-mono text-[11px] text-mute">{task.status}</span>
                    </li>
                  ))}
                </Group>
              </div>
            )}
          </Panel>

          <Panel title="Regression evals" kicker={evalReport ? `${evalReport.passed}/${evalReport.passed + evalReport.failed} passed` : "not run"}>
            <button
              type="button"
              onClick={() => void runEval()}
              disabled={busy !== null}
              className="rounded-lg border border-line px-3 py-2 text-sm text-paper hover:border-amber disabled:opacity-50"
            >
              {busy === "eval" ? "Running golden set…" : "Run golden set"}
            </button>
            {!evalReport ? (
              <Empty
                title="Repeatable behavioral checks"
                body="pnpm eval runs the same deterministic fixtures. This is regression evidence, not an LLM accuracy benchmark."
              />
            ) : (
              <ul className="mt-3 space-y-1">
                {evalReport.results.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 font-mono text-[11px]">
                    <span className="text-mute">{row.id}</span>
                    <span className={row.pass ? "text-mint" : "text-rose"}>{row.pass ? "PASS" : "FAIL"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </section>

      <footer className="border-t border-line pt-4 text-xs leading-5 text-mute">
        Start with <code className="font-mono text-paper">src/mcp/tools.ts</code> (schema
        narrowing), <code className="font-mono text-paper">src/eval/run.ts</code> (golden set), then{" "}
        <code className="font-mono text-paper">pnpm agent --demo</code>. MIT. Built by Brenden Dearie.
      </footer>
    </div>
  );
}

function Panel({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-4 shadow-[0_0_0_1px_rgba(232,165,75,0.04)]">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="font-mono text-[11px] text-mute">{kicker}</span>
      </div>
      {children}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 font-mono text-[11px] tracking-wide text-amber uppercase">{title}</h3>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-line px-3 py-4">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs leading-5 text-mute">{body}</p>
    </div>
  );
}

function Hint({ annotations }: { annotations?: Record<string, unknown> }) {
  if (!annotations) return null;
  const readOnly = annotations.readOnlyHint === true;
  const destructive = annotations.destructiveHint === true;
  const label = destructive ? "destructive" : readOnly ? "read" : "write";
  const color = destructive ? "text-rose border-rose/30" : readOnly ? "text-mute border-line" : "text-amber border-amber/30";
  return <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${color}`}>{label}</span>;
}
