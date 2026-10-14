import { spawn } from "node:child_process";
import type { Env } from "./paths";

/** Everything the CLI touches in the outside world, injectable for tests. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: Env;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep: (ms: number) => Promise<void>;
  openBrowser: (url: string) => void;
  /** Read a secret without echoing it. Resolves null when there is no terminal. */
  promptSecret: (question: string) => Promise<string | null>;
}

export function defaultIO(): CliIO {
  return {
    stdout: (t) => process.stdout.write(t),
    stderr: (t) => process.stderr.write(t),
    env: process.env,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    openBrowser,
    promptSecret,
  };
}

/** Best effort; failures are ignored (the URL is always printed too). */
export function openBrowser(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    let cmd: string;
    let args: string[];
    if (process.platform === "darwin") {
      cmd = "open";
      args = [url];
    } else if (process.platform === "win32") {
      cmd = "cmd";
      args = ["/c", "start", "", url.replace(/&/g, "^&")];
    } else {
      cmd = "xdg-open";
      args = [url];
    }
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* ignore */
  }
}

export function promptSecret(question: string): Promise<string | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk: Buffer | string) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          process.stderr.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          process.stderr.write("\n");
          reject(new Error("cancelled"));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
