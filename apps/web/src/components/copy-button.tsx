"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "./ui/toast";

export function CopyButton({ text, className, label = "Copy" }: { text: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={label}
      className={cn("inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", className)}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast("Copied to clipboard");
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </button>
  );
}

export function CodeLine({ code }: { code: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/60 py-1.5 pl-3 pr-1.5 font-mono text-sm">
      <span className="select-all overflow-x-auto whitespace-nowrap">{code}</span>
      <CopyButton text={code} className="ml-auto" />
    </div>
  );
}
