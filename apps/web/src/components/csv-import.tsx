"use client";

import {
  chunkRows,
  formatInteger,
  formatTokens,
  GENERIC_CSV_COLUMNS,
  isCursorCsv,
  MAX_ROWS_PER_REQUEST,
  parseCsvRecords,
  parseCursorCsv,
  parseGenericCsv,
  SOURCE_LABELS,
  SOURCES,
  totalTokens,
  type IngestResponse,
  type Source,
  type UsageRow,
} from "@tokenrank/shared";
import { FileUp, Loader2, ShieldCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { callApi, ClientApiError } from "@/lib/client-api";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Label, Select } from "./ui/input";

type Kind = "cursor" | "generic";

/**
 * The file never leaves the browser: it is parsed here, aggregated into daily
 * rows, previewed, and only those rows are uploaded.
 */
export function CsvImport({ timeZone }: { timeZone: string }) {
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<Kind>("cursor");
  const [member, setMember] = useState<string>("");
  const [defaultSource, setDefaultSource] = useState<Source>("other");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result =
    text === null
      ? null
      : kind === "cursor"
        ? parseCursorCsv(text, { timeZone, user: member || null })
        : { ...parseGenericCsv(text, { timeZone, defaultSource }), users: null };
  const rows: UsageRow[] = result?.rows ?? [];
  const days = new Set(rows.map((r) => r.date));
  const total = rows.reduce((s, r) => s + totalTokens(r), 0);

  async function upload() {
    setBusy(true);
    setError(null);
    const agg: IngestResponse = { accepted: 0, inserted: 0, updated: 0, skipped_verified: 0, flagged: 0 };
    try {
      for (const chunk of chunkRows(rows, MAX_ROWS_PER_REQUEST)) {
        const r = await callApi<IngestResponse>("/api/me/import", { body: chunk });
        for (const k of Object.keys(agg) as (keyof IngestResponse)[]) agg[k] += r[k];
      }
      setDone(agg);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <Alert variant="success" className="flex gap-2">
        <ShieldCheck className="mt-0.5 shrink-0" />
        <span>Your file is parsed in this browser tab. Only the daily totals in the preview below are uploaded. Emails, costs and any other columns stay on your device.</span>
      </Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="kind">File type</Label>
          <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-full">
            <option value="cursor">Cursor usage export (cursor.com/dashboard → Usage → Export)</option>
            <option value="generic">Generic TokenRank CSV</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="file">CSV file</Label>
          <label htmlFor="file" className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted">
            <FileUp className="size-4" /> {fileName || "Choose a .csv file"}
          </label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setDone(null);
              setMember("");
              setFileName(f.name);
              const t = await f.text();
              setText(t);
              const { headers } = parseCsvRecords(t.split(/\r?\n/, 1)[0] ?? "");
              setKind(isCursorCsv(headers) ? "cursor" : "generic");
            }}
          />
        </div>
      </div>

      {kind === "generic" && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Columns: {GENERIC_CSV_COLUMNS.map((c) => <code key={c} className="mr-1 rounded bg-muted px-1 text-xs">{c}</code>)}. Only{" "}
            <code className="rounded bg-muted px-1 text-xs">date</code> and <code className="rounded bg-muted px-1 text-xs">model</code> are required. Files with any other column are refused.
          </p>
          <div className="flex items-center gap-2">
            <Label htmlFor="default-source">Source when the column is missing</Label>
            <Select id="default-source" value={defaultSource} onChange={(e) => setDefaultSource(e.target.value as Source)}>
              {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
            </Select>
          </div>
        </div>
      )}

      {result?.users && result.users.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor="member">This is a team export. Which member is you?</Label>
          <Select id="member" value={member} onChange={(e) => setMember(e.target.value)} className="w-full max-w-sm">
            <option value="">Choose…</option>
            {result.users.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">Used only here to filter rows. Other members&apos; rows and all emails are discarded.</p>
        </div>
      )}

      {result && result.errors.length > 0 && (
        <Alert variant={rows.length ? "warning" : "destructive"}>
          <ul className="list-disc pl-4">{result.errors.slice(0, 6).map((e) => <li key={e}>{e}</li>)}</ul>
        </Alert>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm">
            <strong>{formatInteger(rows.length)}</strong> daily rows across <strong>{days.size}</strong> days ·{" "}
            <strong>{formatTokens(total)}</strong> tokens · bucketed in {timeZone}
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left">
                <tr>
                  <th className="px-2 py-1.5">date</th><th className="px-2 py-1.5">source</th><th className="px-2 py-1.5">model</th><th className="px-2 py-1.5">category</th>
                  <th className="px-2 py-1.5 text-right">input</th><th className="px-2 py-1.5 text-right">output</th><th className="px-2 py-1.5 text-right">cache read</th><th className="px-2 py-1.5 text-right">cache write</th><th className="px-2 py-1.5 text-right">requests</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.slice(0, 200).map((r) => (
                  <tr key={`${r.date}${r.source}${r.model}${r.category}`} className="border-t">
                    <td className="px-2 py-1">{r.date}</td><td className="px-2 py-1">{r.source}</td><td className="px-2 py-1 font-mono">{r.model}</td><td className="px-2 py-1">{r.category}</td>
                    <td className="px-2 py-1 text-right">{formatInteger(r.input_tokens)}</td><td className="px-2 py-1 text-right">{formatInteger(r.output_tokens)}</td>
                    <td className="px-2 py-1 text-right">{formatInteger(r.cache_read_tokens)}</td><td className="px-2 py-1 text-right">{formatInteger(r.cache_write_tokens)}</td><td className="px-2 py-1 text-right">{formatInteger(r.request_count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="text-xs text-muted-foreground">Showing the first 200 rows.</p>}
          {error && <Alert variant="destructive">{error}</Alert>}
          {done ? (
            <Alert variant="success">
              Uploaded: {done.inserted} new, {done.updated} updated{done.skipped_verified ? `, ${done.skipped_verified} skipped (already verified)` : ""}
              {done.flagged ? `, ${done.flagged} held for review` : ""}. Re-uploading the same file is safe: days are replaced, never double-counted.{" "}
              <Link href="/leaderboard" className="font-medium underline">See the leaderboard</Link>
            </Alert>
          ) : (
            <Button onClick={upload} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload {formatInteger(rows.length)} rows
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
