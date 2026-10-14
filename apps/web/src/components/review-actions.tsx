"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/client-api";
import { Button } from "./ui/button";

export function ReviewActions({ userId, date, source }: { userId: string; date: string; source: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    try {
      await callApi("/api/admin/review", { body: { user_id: userId, date, source, decision } });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={busy} onClick={() => decide("approved")}>Approve</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("rejected")}>Keep excluded</Button>
    </div>
  );
}
