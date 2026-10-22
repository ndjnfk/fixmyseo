"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../../../lib/api";

const Ctx = createContext(null);
export const useSite = () => useContext(Ctx);

export const JOB_LABEL = { audit: "Audit", keywords: "Keywords", gsc: "GSC sync", alerts: "Alerts", indexing: "Indexing" };
export const when = (t) => (t ? new Date(t).toLocaleString() : "-");

export function SiteProvider({ id, children }) {
  const [data, setData] = useState(null);
  const [auto, setAuto] = useState(null);
  const [pending, setPending] = useState(0);
  const [err, setErr] = useState("");

  const load = () => api(`/sites/${id}`).then(setData).catch((e) => setErr(e.message));
  const loadAuto = () => api(`/sites/${id}/automation`).then(setAuto).catch((e) => setErr(e.message));
  const loadPending = () => api(`/sites/${id}/suggestions?status=proposed&limit=100`).then((s) => setPending(s.length)).catch(() => {});

  useEffect(() => {
    load(); loadAuto(); loadPending();
    const a = setInterval(load, 5000);
    const b = setInterval(loadAuto, 8000);
    const c = setInterval(loadPending, 15000);
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [id]);

  async function call(path, body) {
    try { await api(path, { method: "POST", body }); await loadAuto(); return ""; }
    catch (e) { return e.message; }
  }

  const canEdit = ["editor", "admin", "owner"].includes(data?.role);
  const isAdmin = ["admin", "owner"].includes(data?.role);
  return <Ctx.Provider value={{ id, data, auto, pending, err, load, loadAuto, loadPending, call, canEdit, isAdmin }}>{children}</Ctx.Provider>;
}
