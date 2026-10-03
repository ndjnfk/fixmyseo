"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../../../lib/api";

const Ctx = createContext(null);
export const useSite = () => useContext(Ctx);

export const JOB_LABEL = {
  audit: "Audit", keywords: "Keywords", gsc: "GSC sync", alerts: "Alerts",
  indexing: "Indexing",
};
export const when = (t) => new Date(t).toLocaleString();

export function SiteProvider({ id, children }) {
  const [data, setData] = useState(null);
  const [auto, setAuto] = useState(null);
  const [err, setErr] = useState("");

  const load = () => api(`/sites/${id}`).then(setData).catch((e) => setErr(e.message));
  const loadAuto = () => api(`/sites/${id}/automation`).then(setAuto).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    loadAuto();
    const a = setInterval(load, 5000);
    const b = setInterval(loadAuto, 8000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [id]);

  // POST to an automation endpoint, then refresh. Returns error message or "".
  async function call(path, body) {
    try { await api(path, { method: "POST", body }); await loadAuto(); return ""; }
    catch (e) { return e.message; }
  }

  return <Ctx.Provider value={{ id, data, auto, err, load, loadAuto, call }}>{children}</Ctx.Provider>;
}
