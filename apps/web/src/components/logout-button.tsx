"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { callApi } from "@/lib/client-api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={async () => {
        await callApi("/api/auth/logout", { method: "POST", body: {} });
        router.push("/");
        router.refresh();
      }}
    >
      <LogOut className="size-4" /> Log out
    </button>
  );
}
