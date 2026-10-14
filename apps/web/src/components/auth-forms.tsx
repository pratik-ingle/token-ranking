"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { validateUsername } from "@tokenrank/shared";
import { Check, Fingerprint, KeyRound, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { safeNext } from "@/lib/safe-next";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ClientApiError) return e.message;
  if (e instanceof Error && e.name === "NotAllowedError") return "Passkey prompt was cancelled.";
  if (e instanceof Error && e.name === "InvalidStateError") return "This device already has a passkey for that account.";
  return "Something went wrong. Please try again.";
}

type Availability = { state: "idle" | "checking" | "ok" | "bad"; message?: string };

export function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [passkeys, setPasskeys] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability>({ state: "idle" });

  useEffect(() => {
    const ok = browserSupportsWebAuthn();
    setPasskeys(ok);
    if (!ok) setUsePassword(true);
  }, []);

  useEffect(() => {
    if (!username) return setAvail({ state: "idle" });
    const local = validateUsername(username);
    if (!local.ok) return setAvail({ state: "bad", message: local.message });
    setAvail({ state: "checking" });
    const t = setTimeout(async () => {
      try {
        const r = await callApi<{ available: boolean; message?: string }>(`/api/auth/username?u=${encodeURIComponent(username)}`);
        setAvail(r.available ? { state: "ok", message: "Available" } : { state: "bad", message: r.message });
      } catch {
        setAvail({ state: "idle" });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [username]);

  const done = () => {
    router.push(safeNext(next, "/onboarding"));
    router.refresh();
  };

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await callApi<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/auth/passkey/register/options", { body: { username } });
      const response = await startRegistration({ optionsJSON });
      await callApi("/api/auth/passkey/register/verify", { body: { response, timezone: browserTimeZone() } });
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function withPassword() {
    setBusy(true);
    setError(null);
    try {
      await callApi("/api/auth/signup", { body: { username, password, timezone: browserTimeZone() } });
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void (usePassword ? withPassword() : withPasskey());
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          autoComplete="username webauthn"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="e.g. quiet_otter"
          value={username}
          maxLength={24}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          required
        />
        <p className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
          {avail.state === "checking" && <Loader2 className="size-3 animate-spin" />}
          {avail.state === "ok" && <Check className="size-3 text-primary" />}
          {avail.state === "bad" && <X className="size-3 text-destructive" />}
          {avail.message ?? "3–24 characters: a–z, 0–9 and underscore. This is the only thing we ask for."}
        </p>
      </div>

      {usePassword && (
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
      )}

      {error && <Alert variant="destructive">{error}</Alert>}

      <Button type="submit" className="w-full" size="lg" disabled={busy || avail.state === "bad" || !username}>
        {busy ? <Loader2 className="animate-spin" /> : usePassword ? <KeyRound /> : <Fingerprint />}
        {usePassword ? "Create account" : "Create account with a passkey"}
      </Button>
      {passkeys && (
        <button type="button" className="w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setUsePassword((v) => !v)}>
          {usePassword ? "Use a passkey instead (recommended)" : "No passkey? Use a password instead"}
        </button>
      )}
      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-primary hover:underline">Log in</Link>
      </p>
    </form>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeys, setPasskeys] = useState(true);

  useEffect(() => setPasskeys(browserSupportsWebAuthn()), []);

  const done = () => {
    router.push(safeNext(next, "/leaderboard"));
    router.refresh();
  };

  async function withPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await callApi<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/passkey/login/options", { body: {} });
      const response = await startAuthentication({ optionsJSON });
      await callApi("/api/auth/passkey/login/verify", { body: { response } });
      done();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function withPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await callApi("/api/auth/login", { body: { username, password } });
      done();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {passkeys && (
        <Button type="button" size="lg" className="w-full" disabled={busy} onClick={withPasskey}>
          {busy ? <Loader2 className="animate-spin" /> : <Fingerprint />} Sign in with a passkey
        </Button>
      )}
      <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or use a password <span className="h-px flex-1 bg-border" />
      </div>
      <form className="space-y-4" onSubmit={withPassword}>
        <div className="space-y-2">
          <Label htmlFor="login-username">Username</Label>
          <Input id="login-username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="login-password">Password</Label>
          <Input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <Button type="submit" variant="outline" className="w-full" disabled={busy}>
          <KeyRound /> Log in
        </Button>
      </form>
      <div className="flex justify-between text-sm text-muted-foreground">
        <Link href="/recover" className="hover:text-foreground">Lost access?</Link>
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-primary hover:underline">Create an account</Link>
      </div>
    </div>
  );
}
