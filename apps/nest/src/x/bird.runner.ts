import { Logger } from "@nestjs/common";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const BIRD_BIN = process.env.BIRD_BIN ?? resolveBirdBin();
const DEFAULT_TIMEOUT_MS = 30_000;

export interface BirdCreds {
  auth_token: string;
  ct0: string;
}

export interface BirdRunOptions {
  timeoutMs?: number;
}

export class BirdError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
    public readonly code?: number | null,
  ) {
    super(message);
    this.name = "BirdError";
  }
}

const logger = new Logger("BirdRunner");

function resolveBirdBin() {
  let directory = process.cwd();
  while (true) {
    const candidate = join(directory, "node_modules", ".bin", "bird");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) return "bird";
    directory = parent;
  }
}

function formatBirdInvocationError(err: any) {
  if (err?.code === "ENOENT") {
    return `bird CLI not found at "${BIRD_BIN}". Run yarn install or set BIRD_BIN to the executable path.`;
  }
  return err?.message ?? "bird invocation failed";
}

function authFlags(creds: BirdCreds): string[] {
  return [
    "--auth-token",
    creds.auth_token,
    "--ct0",
    creds.ct0,
    "--no-color",
    "--no-emoji",
  ];
}

export async function birdJson<T = unknown>(
  args: string[],
  creds: BirdCreds,
  opts: BirdRunOptions = {},
): Promise<T> {
  const fullArgs = [...authFlags(creds), ...args, "--json"];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout } = await execFileP(BIRD_BIN, fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!stdout || stdout.trim().length === 0) {
      throw new BirdError("Empty bird response");
    }
    return JSON.parse(stdout) as T;
  } catch (err: any) {
    if (err instanceof BirdError) throw err;
    const stderr = err?.stderr?.toString?.() ?? "";
    logger.warn(`bird ${args.join(" ")} failed: ${err?.message}`);
    throw new BirdError(
      formatBirdInvocationError(err),
      stderr,
      err?.code ?? null,
    );
  }
}

export async function birdRaw(
  args: string[],
  creds: BirdCreds,
  opts: BirdRunOptions = {},
): Promise<string> {
  const fullArgs = [...authFlags(creds), ...args];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const { stdout } = await execFileP(BIRD_BIN, fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout ?? "";
  } catch (err: any) {
    const stderr = err?.stderr?.toString?.() ?? "";
    throw new BirdError(
      formatBirdInvocationError(err),
      stderr,
      err?.code ?? null,
    );
  }
}

const HANDLE_FROM_OUTPUT = /@([A-Za-z0-9_]{1,15})/;

export async function birdCheck(creds: BirdCreds) {
  try {
    // `bird whoami` does NOT accept --json. Plain output looks like
    // `Logged in as @handle (ID: 123...)`. Extract the handle from text.
    const stdout = await birdRaw(["--plain", "whoami"], creds, {
      timeoutMs: 15_000,
    });
    const match = stdout.match(HANDLE_FROM_OUTPUT);
    const handle = match?.[1];
    return { ok: true as const, handle };
  } catch (err: any) {
    return {
      ok: false as const,
      error: err?.stderr?.trim?.() || err?.message || "bird check failed",
    };
  }
}
