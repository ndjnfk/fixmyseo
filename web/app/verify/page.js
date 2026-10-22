"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "../../lib/api";
import { Card } from "../../components/ui";

function Verify() {
  const params = useSearchParams();
  const [state, setState] = useState("working");
  useEffect(() => {
    const token = params.get("token");
    if (!token) return setState("missing");
    api("/auth/verify", { method: "POST", body: { token } }).then(() => setState("ok")).catch(() => setState("bad"));
  }, []);
  return (
    <div className="wrap page" style={{ maxWidth: 480 }}>
      <Card title="Email verification">
        {state === "working" && <p className="muted">Verifying...</p>}
        {state === "ok" && <p className="ok">Your email is verified. <Link href="/sites">Go to the dashboard</Link>.</p>}
        {state === "bad" && <p className="err">This link is invalid or expired. Request a new one from the dashboard.</p>}
        {state === "missing" && <p className="err">Missing token.</p>}
      </Card>
    </div>
  );
}

export default function VerifyPage() {
  return <Suspense fallback={null}><Verify /></Suspense>;
}
