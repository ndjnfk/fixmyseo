"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getToken, setToken, takeLogoutReason } from "../lib/api";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState("login");
  const [f, setF] = useState({ email: "", password: "", orgName: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState("");

  useEffect(() => {
    if (getToken()) router.replace("/sites");
    else setEnded(takeLogoutReason());
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const body = mode === "login" ? { email: f.email, password: f.password } : f;
      const { token } = await api(`/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", body });
      setToken(token);
      router.push("/sites");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const login = mode === "login";

  return (
    <div className="auth">
      <section className="auth-intro">
        <h1>Find and fix what holds your site back on Google</h1>
        <p className="muted">FixMySEO audits your website, researches keywords and brings in your Google Search Console data, then tells you exactly what to fix next.</p>
        <ul>
          <li>Technical SEO audit of every page</li>
          <li>Keyword research with demand and difficulty</li>
          <li>Search Console clicks, positions and quick wins</li>
          <li>Recommendations, index checks and traffic alerts</li>
        </ul>
        <p className="muted small">
          Connecting Google is optional. See our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms</Link>.
        </p>
      </section>
      <form className="card" onSubmit={submit}>
        <h1>{login ? "Welcome back" : "Create your account"}</h1>
        <p className="muted" style={{ margin: "0 0 20px" }}>
          {login ? "Log in to your FixMySEO dashboard." : "Create a free account and run your first site audit."}
        </p>
        <div className="stack" style={{ gap: 14 }}>
          {!login && (
            <label className="field"><span>Organization name</span>
              <input placeholder="Acme Inc." value={f.orgName} onChange={set("orgName")} required />
            </label>
          )}
          <label className="field"><span>Email</span>
            <input type="email" placeholder="you@example.com" value={f.email} onChange={set("email")} required />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" placeholder="Min 8 characters" value={f.password} onChange={set("password")} required minLength={8} />
          </label>
          {ended && !err && <div className="notice warn small">Your session ended ({ended}). Please log in again.</div>}
          {err && <div className="notice error">{err}</div>}
          <button disabled={busy} style={{ width: "100%", padding: "11px 16px" }}>
            {busy ? "Please wait..." : login ? "Login" : "Create account"}
          </button>
          <div className="muted small" style={{ textAlign: "center" }}>
            {login ? "Don't have an account? " : "Already have an account? "}
            <button type="button" className="link-btn" onClick={() => { setErr(""); setMode(login ? "register" : "login"); }}>
              {login ? "Register" : "Login"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
