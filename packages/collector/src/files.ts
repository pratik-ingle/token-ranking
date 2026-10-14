import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

export interface FoundFile {
  path: string;
  /** Path relative to the walked root, with "/" separators. */
  relative: string;
  name: string;
  mtimeMs: number;
  size: number;
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recursively list files under `root` whose name passes `accept`, sorted for
 * deterministic processing order. Symlinked directories are followed once
 * (loop-safe). Unreadable directories are skipped.
 */
export async function walkFiles(
  root: string,
  accept: (name: string) => boolean,
  opts: { maxDepth?: number } = {},
): Promise<FoundFile[]> {
  const maxDepth = opts.maxDepth ?? 12;
  const out: FoundFile[] = [];
  const visited = new Set<string>();

  async function visit(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let real: string;
    try {
      real = await fs.realpath(dir);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = await fs.stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        await visit(full, relPath, depth + 1);
      } else if (isFile && accept(e.name)) {
        try {
          const st = await fs.stat(full);
          out.push({ path: full, relative: relPath, name: e.name, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          /* vanished */
        }
      }
    }
  }

  await visit(root, "", 0);
  return out;
}

/** Lines longer than this are skipped (counted by the caller via onOversized). */
export const MAX_LINE_BYTES = 256 * 1024 * 1024;

/**
 * Stream a file line by line as raw bytes (no UTF-8 decoding). The Buffer
 * passed to `onLine` is only valid during the callback.
 */
export async function readLines(
  filePath: string,
  onLine: (line: Buffer) => void,
  opts: { chunkSize?: number; onOversized?: () => void } = {},
): Promise<void> {
  const chunkSize = opts.chunkSize ?? 1 << 20;
  const fh = await fs.open(filePath, "r");
  try {
    let carry: Buffer[] = [];
    let carryLen = 0;
    let dropping = false;
    const emit = (line: Buffer) => {
      let end = line.length;
      if (end > 0 && line[end - 1] === 0x0d) end--;
      if (end === 0) return;
      onLine(end === line.length ? line : line.subarray(0, end));
    };
    for (;;) {
      const buf = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await fh.read(buf, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      let start = 0;
      for (;;) {
        const nl = chunk.indexOf(0x0a, start);
        if (nl < 0) break;
        if (dropping) {
          dropping = false;
        } else if (carryLen > 0) {
          carry.push(chunk.subarray(start, nl));
          emit(Buffer.concat(carry));
        } else {
          emit(chunk.subarray(start, nl));
        }
        carry = [];
        carryLen = 0;
        start = nl + 1;
      }
      if (start < bytesRead && !dropping) {
        carry.push(chunk.subarray(start));
        carryLen += bytesRead - start;
        if (carryLen > MAX_LINE_BYTES) {
          carry = [];
          carryLen = 0;
          dropping = true;
          opts.onOversized?.();
        }
      }
    }
    if (carryLen > 0 && !dropping) emit(Buffer.concat(carry));
  } finally {
    await fh.close();
  }
}

/** Iterate the lines of an in-memory buffer (used for decompressed files). */
export function forEachLineInBuffer(buf: Buffer, onLine: (line: Buffer) => void): void {
  let start = 0;
  while (start < buf.length) {
    let nl = buf.indexOf(0x0a, start);
    if (nl < 0) nl = buf.length;
    let end = nl;
    if (end > start && buf[end - 1] === 0x0d) end--;
    if (end > start) onLine(buf.subarray(start, end));
    start = nl + 1;
  }
}
