"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Input, Label } from "../ui/input";

export function SecuritySettings({ passkeyCount, hasPassword, hasRecoveryEmail }: { passkeyCount: number; hasPassword: boolean; hasRecoveryEmail: boolean }) {
  const router = useRouter();
  const [supports, setSupports] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => setSupports(browserSupportsWebAuthn()), []);

  async function run(id: string, fn: () => Promise<string>) {
    setBusy(id);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      router.refresh();
    } catch (e) {
      const text = e instanceof ClientApiError ? e.message : e instanceof Error && e.name === "NotAllowedError" ? "Passkey prompt was cancelled." : "Something went wrong.";
      setMsg({ ok: false, text });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {msg && <Alert variant={msg.ok ? "success" : "destructive"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Passkeys</p>
          <p className="text-xs text-muted-foreground">{passkeyCount} registered</p>
        </div>
        <Button
          variant="outline"
          disabled={!supports || busy === "pk"}
          onClick={() =>
            run("pk", async () => {
              const optionsJSON = await callApi<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/passkey/add/options", { body: {} });
              const response = await startRegistration({ optionsJSON });
              await callApi("/api/auth/passkey/add/verify", { body: { response } });
              return "Passkey added.";
            })
          }
        >
          {busy === "pk" ? <Loader2 className="animate-spin" /> : <Fingerprint />} Add a passkey
        </Button>
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("pw", async () => {
            await callApi("/api/me/password", { method: "PUT", body: { current: hasPassword ? current : undefined, password: pw } });
            setPw("");
            setCurrent("");
            return "Password saved.";
          });
        }}
      >
        <p className="text-sm font-medium">{hasPassword ? "Change password" : "Set a fallback password"}</p>
        <div className="flex flex-wrap gap-2">
          {hasPassword && <Input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className="max-w-xs" required />}
          <Input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} className="max-w-xs" required />
          <Button type="submit" variant="outline" disabled={busy === "pw"}>Save password</Button>
        </div>
      </form>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("email", async () => {
            await callApi("/api/me/recovery-email", { method: "PUT", body: { email } });
            setEmail("");
            return "Recovery email saved (as a hash).";
          });
        }}
      >
        <Label htmlFor="recovery-email">Recovery email (optional)</Label>
        <p className="text-xs text-muted-foreground">
          {hasRecoveryEmail ? "A recovery email is set. " : ""}We store only an HMAC of the address: enough to match it when you ask for a
          recovery link, never enough to read it, show it or email you otherwise.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input id="recovery-email" type="email" placeholder={hasRecoveryEmail ? "Replace recovery email" : "you@example.com"} value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-xs" required />
          <Button type="submit" variant="outline" disabled={busy === "email"}>Save</Button>
          {hasRecoveryEmail && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                run("email", async () => {
                  await callApi("/api/me/recovery-email", { method: "PUT", body: { email: null } });
                  return "Recovery email removed.";
                })
              }
            >
              Remove
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
