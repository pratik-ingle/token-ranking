"use client";

import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client-api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1.5 text-sm text-ink-2 hover:bg-card hover:text-foreground"
      onClick={async () => {
        await callApi("/api/auth/logout", { method: "POST", body: {} });
        router.push("/");
        router.refresh();
      }}
    >
      Log out
    </button>
  );
}
