"use client";

import { Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";

export function RecoverRequestForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const r = await callApi<{ message: string }>("/api/auth/recover", { body: { email } });
          setMessage(r.message);
        } catch (err) {
          setMessage(err instanceof ClientApiError ? err.message : "Something went wrong.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">Recovery email</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      {message && <Alert variant="success">{message}</Alert>}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <Mail />} Send sign-in link
      </Button>
    </form>
  );
}

export function RecoverCompleteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await callApi("/api/auth/recover/complete", { body: { token } });
            router.push("/settings#security");
            router.refresh();
          } catch (e) {
            setError(e instanceof ClientApiError ? e.message : "Something went wrong.");
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="animate-spin" />} Sign in and secure my account
      </Button>
    </div>
  );
}
