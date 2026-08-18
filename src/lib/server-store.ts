/**
 * Durable JSON store for server routes.
 *
 * The previous code wrote to `public/custom_deployments.json` and
 * `public/agent_telemetry.json` under `process.cwd()`. In the production image
 * `/app` and `/app/public` are owned by root with mode 755 while the app runs as
 * uid 1001, so every write failed with EACCES. Deployment records and telemetry
 * therefore only ever lived in one process's memory and vanished on restart —
 * `custom_deployments.json` returned 404 in production and the telemetry POST
 * returned 500.
 *
 * Resolution order for the data directory:
 *   1. ADEXTO_DATA_DIR (set to /app/data in the container, backed by a volume)
 *   2. <cwd>/.data
 *   3. <tmpdir>/adexto-data  (last resort so the app degrades instead of failing)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let resolvedDir: string | null = null;
let warned = false;

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

export function dataDir(): string {
  if (resolvedDir) return resolvedDir;

  const candidates = [
    process.env.ADEXTO_DATA_DIR,
    path.join(process.cwd(), ".data"),
    path.join(os.tmpdir(), "adexto-data"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (canWrite(candidate)) {
      resolvedDir = candidate;
      if (candidate !== candidates[0] && !warned) {
        warned = true;
        console.warn(
          `[adexto] ADEXTO_DATA_DIR not writable, falling back to ${candidate}. ` +
            `Mount a writable volume and set ADEXTO_DATA_DIR for durable storage.`
        );
      }
      return resolvedDir;
    }
  }

  resolvedDir = path.join(os.tmpdir(), `adexto-data-${process.pid}`);
  fs.mkdirSync(resolvedDir, { recursive: true });
  return resolvedDir;
}

export function isDurable(): boolean {
  const dir = dataDir();
  return dir === process.env.ADEXTO_DATA_DIR || dir === path.join(process.cwd(), ".data");
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const full = path.join(dataDir(), file);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, "utf8")) as T;
  } catch (error) {
    console.warn(`[adexto] failed to read ${file}:`, (error as Error).message);
    return fallback;
  }
}

/** Atomic write: temp file + rename, so a crash cannot truncate the store. */
export function writeJson(file: string, value: unknown): boolean {
  try {
    const dir = dataDir();
    const full = path.join(dir, file);
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8" });
    fs.renameSync(tmp, full);
    return true;
  } catch (error) {
    console.error(`[adexto] failed to write ${file}:`, (error as Error).message);
    return false;
  }
}
