"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { Card, Field } from "../../components/ui";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") || "";
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault(); setErr("");
    try { await api("/auth/reset", { method: "POST", body: { token, password: pw } }); setDone(true); setTimeout(() => router.push("/"), 1500); }
    catch (e) { setErr(e.message); }
  }
  return (
    <div className="wrap page" style={{ maxWidth: 480 }}>
      <Card title="Set a new password">
        {done ? <p className="ok">Password updated. Redirecting to login...</p> : (
          <form className="stack" onSubmit={submit}>
            <Field label="New password (8+ characters)"><input type="password" minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
            {!token && <div className="notice warn">This link is missing its token. Request a new reset email.</div>}
            {err && <div className="notice error">{err}</div>}
            <button disabled={!token}>Save password</button>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function Reset() {
  return <Suspense fallback={null}><ResetForm /></Suspense>;
}
