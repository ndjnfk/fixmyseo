"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getToken, when } from "../../lib/api";
import { Badge, Card, Empty, Field, PageHead } from "../../components/ui";

const ROLES = ["viewer", "editor", "admin"];
const DESC = { owner: "Billing and everything below", admin: "Sites, settings, members, Google connection", editor: "Run audits & AI, approve suggestions, keywords", viewer: "Read-only" };

export default function Team() {
  const router = useRouter();
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState(null);
  const [log, setLog] = useState([]);
  const [f, setF] = useState({ email: "", role: "editor" });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const m = await api("/me"); setMe(m);
      if (["admin", "owner"].includes(m.org.role)) { setMembers(await api("/org/members")); setLog(await api("/audit-log?limit=50")); } else setMembers([]);
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { if (!getToken()) return router.push("/"); load(); }, []);

  async function add(e) {
    e.preventDefault(); setErr(""); setMsg("");
    try { await api("/org/members", { method: "POST", body: f }); setMsg(`${f.email} added as ${f.role}`); setF({ email: "", role: "editor" }); load(); }
    catch (e) { setErr(e.message); }
  }
  const setRole = async (uid, role) => { setErr(""); try { await api(`/org/members/${uid}`, { method: "PATCH", body: { role } }); load(); } catch (e) { setErr(e.message); } };
  const remove = async (m) => { if (!confirm(`Remove ${m.email}?`)) return; setErr(""); try { await api(`/org/members/${m.id}`, { method: "DELETE" }); load(); } catch (e) { setErr(e.message); } };

  if (!me) return <div className="wrap page">{err ? <div className="notice error">{err}</div> : <span className="muted">Loading...</span>}</div>;
  const isAdmin = ["admin", "owner"].includes(me.org.role);
  return (
    <div className="wrap page">
      <PageHead title="Team" desc={`${me.org.name} · you are ${me.org.role}`} />
      <div className="stack">
        {!isAdmin && <Card><Empty title="Members are managed by admins">Ask an admin or the owner to change roles.</Empty></Card>}
        {isAdmin && (
          <>
            <Card title="Add a member">
              <form className="row" onSubmit={add}>
                <input style={{ flex: 1, minWidth: 220 }} type="email" placeholder="colleague@example.com (must have an account)" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
                <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ width: "auto" }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                <button>Add</button>
              </form>
              <div className="grid2 small" style={{ marginTop: 14 }}>{Object.entries(DESC).map(([r, d]) => <div key={r}><Badge tone="info">{r}</Badge> <span className="muted">{d}</span></div>)}</div>
              {msg && <div className="notice" style={{ marginTop: 12 }}>{msg}</div>}
              {err && <div className="notice error" style={{ marginTop: 12 }}>{err}</div>}
            </Card>
            <Card title="Members" flush>
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table><thead><tr><th>Email</th><th>Role</th><th>Last login</th><th /></tr></thead><tbody>
                  {(members || []).map((m) => (
                    <tr key={m.id}>
                      <td>{m.email}{m.id === me.user.id && <span className="muted small"> (you)</span>}</td>
                      <td>{m.role === "owner" ? <Badge tone="done">owner</Badge> : <select value={m.role} onChange={(e) => setRole(m.id, e.target.value)} style={{ width: "auto" }}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>}</td>
                      <td className="muted nowrap">{when(m.last_login_at)}</td>
                      <td>{m.role !== "owner" && <button className="ghost sm" onClick={() => remove(m)}>Remove</button>}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </Card>
            <Card title="Audit log" flush>
              {log.length === 0 ? <Empty>Nothing yet.</Empty> : (
                <div className="table-wrap scroll" style={{ marginTop: 14, maxHeight: 420 }}>
                  <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>
                    {log.map((l) => <tr key={l.id}><td className="nowrap muted">{when(l.created_at)}</td><td>{l.email || <span className="muted">system</span>}</td><td className="nowrap">{l.action}</td><td className="muted">{l.entity} {l.entity_id}</td><td className="muted small">{l.meta ? JSON.stringify(l.meta).slice(0, 160) : ""}</td></tr>)}
                  </tbody></table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
