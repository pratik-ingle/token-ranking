import * as React from "react";
import { cn } from "@/lib/utils";

export function Alert({ className, variant = "default", ...props }: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "warning" | "destructive" | "success" }) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border p-3 text-sm [&_svg]:inline [&_svg]:size-4",
        variant === "warning" && "border-warning/50 bg-warning/10",
        variant === "destructive" && "border-destructive/40 bg-destructive/10 text-destructive",
        variant === "success" && "border-primary/40 bg-primary/10",
        className,
      )}
      {...props}
    />
  );
}
