import { parseArgs } from "node:util";

/** Bad command-line usage (exit code 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

type OptionSpec = Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }>;

export interface ParsedArgs {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
}

/** `node:util` parseArgs with strict checking and a uniform --help flag. */
export function parse(args: string[], options: OptionSpec): ParsedArgs {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: { ...options, help: { type: "boolean", short: "h" } },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as ParsedArgs["values"], positionals };
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

export function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function optStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return typeof v === "string" && v.length > 0 ? [v] : [];
}
