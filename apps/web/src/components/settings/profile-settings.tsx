"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Label, Select } from "../ui/input";
import { useToast } from "../ui/toast";

export function ProfileSettings({ visibility, timezone }: { visibility: "public" | "hidden"; timezone: string }) {
  const router = useRouter();
  const toast = useToast();
  const [vis, setVis] = useState(visibility);
  const [tz, setTz] = useState(timezone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
    } catch {
      return [timezone];
    }
  }, [timezone]);
  const browserTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Leaderboard visibility</legend>
        {(["public", "hidden"] as const).map((v) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent">
            <input type="radio" name="visibility" value={v} checked={vis === v} onChange={() => setVis(v)} className="mt-1 accent-[var(--primary)]" />
            <span>
              <span className="block text-sm font-medium">{v === "public" ? "Public" : "Hidden"}</span>
              <span className="block text-xs text-muted-foreground">
                {v === "public"
                  ? "Listed on the leaderboard; your profile page is visible to anyone."
                  : "Not listed and profile not visible to others. You still see the rank you would have."}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="tz">Timezone</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select id="tz" value={tz} onChange={(e) => setTz(e.target.value)} className="max-w-xs">
            {[...new Set([tz, ...zones])].map((z) => <option key={z} value={z}>{z}</option>)}
          </Select>
          {browserTz && browserTz !== tz && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setTz(browserTz)}>Use {browserTz}</Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Days, streaks and the heatmap are counted in this timezone. Changing it affects future syncs; re-run a sync to re-bucket past days.
        </p>
      </div>
      {msg && <Alert variant={msg.ok ? "success" : "destructive"}>{msg.text}</Alert>}
      <Button
        disabled={busy || (vis === visibility && tz === timezone)}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            await callApi("/api/me/settings", { method: "PATCH", body: { visibility: vis, timezone: tz } });
            toast("Settings saved");
            router.refresh();
          } catch (e) {
            setMsg({ ok: false, text: e instanceof ClientApiError ? e.message : "Could not save." });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="animate-spin" />} Save
      </Button>
    </div>
  );
}
