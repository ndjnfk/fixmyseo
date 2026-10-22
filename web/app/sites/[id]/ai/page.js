"use client";
import { useEffect, useState } from "react";
import { api, pollJob, when } from "../../../../lib/api";
import { Badge, Card, Chips, Empty, Field } from "../../../../components/ui";
import { useSite } from "../SiteContext";

const TASKS = [
  { key: "titles", label: "Titles & meta", needs: ["url", "keyword?"], desc: "3 title and 3 meta description options for a crawled page." },
  { key: "faq", label: "FAQ ideas", needs: ["url"], desc: "4-6 questions and answers based only on the page text." },
  { key: "brief", label: "Content brief", needs: ["keyword", "url?"], desc: "Outline, FAQs, internal links and the human input needed for a new or existing page." },
  { key: "explain", label: "Explain an issue", needs: ["issue_type"], desc: "Plain-language explanation and fix steps for an audit issue type." },
  { key: "cluster-names", label: "Name keyword clusters", needs: [], desc: "Gives each deterministic keyword cluster a human topic name." },
];

function Payload({ s }) {
  const p = s.payload || {};
  switch (s.type) {
    case "title_meta":
      return (
        <div className="stack" style={{ gap: 8 }}>
          <div className="muted small">Current: <b>{p.current?.title || "(no title)"}</b> / {p.current?.meta || "(no description)"}</div>
          <div><b>Titles</b><ul style={{ margin: "4px 0" }}>{p.titles?.map((t, i) => <li key={i}>{t} <span className="muted small">({t.length})</span></li>)}</ul></div>
          <div><b>Descriptions</b><ul style={{ margin: "4px 0" }}>{p.descriptions?.map((t, i) => <li key={i}>{t} <span className="muted small">({t.length})</span></li>)}</ul></div>
        </div>
      );
    case "faq":
      return <ul style={{ margin: 0 }}>{p.faqs?.map((f, i) => <li key={i}><b>{f.question}</b><div className="muted">{f.answer}</div></li>)}</ul>;
    case "content_brief":
      return (
        <div className="stack" style={{ gap: 8 }}>
          <div><Badge tone="info">{p.intent}</Badge> target ~{p.target_words} words · keyword: <b>{p.keyword}</b></div>
          <ol style={{ margin: 0 }}>{p.outline?.map((o, i) => <li key={i}><b>{o.heading}</b>{o.points?.length > 0 && <div className="muted small">{o.points.join(" · ")}</div>}</li>)}</ol>
          {p.faqs?.length > 0 && <div><b>FAQs</b><ul style={{ margin: "4px 0" }}>{p.faqs.map((f, i) => <li key={i}>{f.question}</li>)}</ul></div>}
          {p.internal_links?.length > 0 && <div className="small"><b>Link to:</b> {p.internal_links.join(", ")}</div>}
          {p.human_input_needed?.length > 0 && <div className="notice warn small"><b>Only you can add:</b> {p.human_input_needed.join("; ")}</div>}
        </div>
      );
    default:
      return <pre className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(p, null, 2)}</pre>;
  }
}

export default function AI() {
  const { id, data, canEdit, loadPending } = useSite();
  const [status, setStatus] = useState(null);
  const [task, setTask] = useState("titles");
  const [f, setF] = useState({ url: "", keyword: "", issue_type: "" });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("proposed");
  const [sugg, setSugg] = useState(null);
  const [jobs, setJobs] = useState([]);

  const load = () => Promise.all([
    api(`/sites/${id}/suggestions?status=${filter === "all" ? "" : filter}`).then(setSugg),
    api(`/sites/${id}/ai/jobs`).then(setJobs),
  ]).catch((e) => setErr(e.message));

  useEffect(() => { api("/ai/status").then(setStatus).catch(() => setStatus({ ok: false, reason: "unreachable" })); }, []);
  useEffect(() => { load(); }, [id, filter]);

  const pages = data?.issues ? [...new Set(data.issues.map((i) => i.url).filter(Boolean))] : [];
  const issueTypes = [...new Set((data?.summary || []).map((s) => s.type))];
  const t = TASKS.find((x) => x.key === task);

  async function run(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setBusy("Queued...");
    const body = task === "titles" ? { url: f.url, ...(f.keyword ? { keyword: f.keyword } : {}) }
      : task === "faq" ? { url: f.url } : task === "brief" ? { keyword: f.keyword, ...(f.url ? { url: f.url } : {}) }
        : task === "explain" ? { issue_type: f.issue_type } : {};
    try {
      const r = await api(`/sites/${id}/ai/${task}`, { method: "POST", body });
      await pollJob(r.job_id, { onTick: (j) => setBusy(`${j.status} ${j.progress || 0}%`) });
      setMsg("Done. Review the result below; nothing is published until you approve it.");
      await load(); loadPending();
    } catch (e) { setErr(e.data?.reason ? `${e.message}: ${e.data.reason}` : e.message); }
    setBusy("");
  }

  async function act(s, action) {
    setErr("");
    try { await api(`/suggestions/${s.id}/${action}`, { method: "POST", body: {} }); await load(); loadPending(); }
    catch (e) { setErr(e.message); }
  }

  return (
    <div className="stack">
      {status && !status.ok && <div className="notice warn">AI is unavailable: {status.reason}. Everything else keeps working; audits and keyword research do not need the model.</div>}
      {status?.ok && <div className="muted small">Local model: <code>{status.model}</code> · outputs are drafts; the model never sees or invents traffic, volume or ranking numbers.</div>}

      {canEdit && (
        <Card title="Generate a suggestion">
          <form className="stack" onSubmit={run} style={{ gap: 14 }}>
            <Chips value={task} onChange={setTask} options={TASKS.map((x) => ({ value: x.key, label: x.label }))} />
            <p className="muted small" style={{ margin: 0 }}>{t.desc}</p>
            <div className="grid2">
              {t.needs.some((n) => n.startsWith("url")) && (
                <Field label={`Page URL${t.needs.includes("url?") ? " (optional)" : ""}`} hint="Must be a page from the latest audit.">
                  <input list="pages" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={data?.site.url + "/"} required={t.needs.includes("url")} />
                  <datalist id="pages">{pages.slice(0, 200).map((u) => <option key={u} value={u} />)}</datalist>
                </Field>
              )}
              {t.needs.some((n) => n.startsWith("keyword")) && (
                <Field label={`Target keyword${t.needs.includes("keyword?") ? " (optional)" : ""}`}>
                  <input value={f.keyword} onChange={(e) => setF({ ...f, keyword: e.target.value })} placeholder="kundli matching" required={t.needs.includes("keyword")} />
                </Field>
              )}
              {t.needs.includes("issue_type") && (
                <Field label="Issue type">
                  <select value={f.issue_type} onChange={(e) => setF({ ...f, issue_type: e.target.value })} required>
                    <option value="">Choose...</option>
                    {issueTypes.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="row">
              <button disabled={Boolean(busy) || status?.ok === false}>{busy || "Generate (1 AI operation)"}</button>
              {msg && <span className="ok small">{msg}</span>}
            </div>
            {err && <div className="notice error">{err}</div>}
          </form>
        </Card>
      )}

      <Card title="Suggestions" actions={<Chips value={filter} onChange={setFilter} options={[
        { value: "proposed", label: "To review" }, { value: "approved", label: "Approved" }, { value: "applied", label: "Applied" }, { value: "rejected", label: "Rejected" }, { value: "all", label: "All" },
      ]} />}>
        {sugg === null ? <span className="muted">Loading...</span> : sugg.length === 0 ? <Empty>Nothing here yet.</Empty> : (
          <div className="stack" style={{ gap: 12 }}>
            {sugg.map((s) => (
              <article key={s.id} className="rec">
                <span className={`badge rec-badge ${s.status === "proposed" ? "info" : s.status === "rejected" ? "low" : "done"}`}>{s.status}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h3>{s.title}</h3>
                  {s.page_url && <a href={s.page_url} target="_blank" rel="noreferrer" className="small">{s.page_url}</a>}
                  <div style={{ margin: "10px 0" }}><Payload s={s} /></div>
                  <div className="muted small">{when(s.created_at)}{s.reviewer && <> · reviewed by {s.reviewer}{s.review_note && `: "${s.review_note}"`}</>}</div>
                  {canEdit && (
                    <div className="row" style={{ marginTop: 10 }}>
                      {s.status === "proposed" && <><button className="sm" onClick={() => act(s, "approve")}>Approve</button><button className="ghost sm" onClick={() => act(s, "reject")}>Reject</button></>}
                      {s.status === "approved" && <button className="sm" onClick={() => act(s, "apply")}>Mark as applied on site</button>}
                      {s.status === "rejected" && <button className="ghost sm" onClick={() => act(s, "reopen")}>Reopen</button>}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card title="AI job history" flush>
        {jobs.length === 0 ? <Empty>No AI jobs yet.</Empty> : (
          <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 360 }}>
            <table>
              <thead><tr><th>When</th><th>Task</th><th>Status</th><th>Model</th><th>Prompt</th><th>Duration</th><th>Tokens</th><th>Result</th></tr></thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td className="muted nowrap">{when(j.created_at)}</td>
                    <td className="nowrap">{j.task}</td>
                    <td><Badge tone={j.status === "done" ? "done" : j.status === "failed" ? "failed" : "info"}>{j.status}</Badge></td>
                    <td className="muted">{j.model || "-"}</td>
                    <td className="muted">{j.prompt_version || "-"}</td>
                    <td className="muted">{j.duration_ms != null ? `${(j.duration_ms / 1000).toFixed(1)}s` : "-"}</td>
                    <td className="muted">{j.prompt_tokens != null ? `${j.prompt_tokens}/${j.output_tokens}` : "-"}</td>
                    <td className="muted small">{j.error ? <span className="err">{j.error}</span> : j.task === "explain" && j.output ? <details><summary>explanation</summary><p>{j.output.explanation}</p><p><b>Why:</b> {j.output.why_it_matters}</p><ol>{j.output.steps?.map((s, i) => <li key={i}>{s}</li>)}</ol></details> : j.output?.suggestions != null ? `${j.output.suggestions} suggestion(s)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
