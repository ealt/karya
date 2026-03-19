import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { KaryaError } from "./errors.js";

const execFile = promisify(execFileCb);

export function isOpReference(value: string): boolean {
  return value.startsWith("op://");
}

export async function resolveOpReference(reference: string): Promise<string> {
  try {
    const { stdout } = await execFile("op", ["read", reference], {
      timeout: 30_000,
    });
    const resolved = stdout.trimEnd();
    if (resolved.length === 0) {
      throw new KaryaError(`1Password reference resolved to an empty value: ${reference}`, "CONFIG");
    }
    return resolved;
  } catch (error) {
    if (error instanceof KaryaError) {
      throw error;
    }

    const err = error as NodeJS.ErrnoException & { stderr?: string };

    if (err.code === "ENOENT") {
      throw new KaryaError(
        "1Password CLI (op) is not installed or not in PATH. "
          + "Install it from https://developer.1password.com/docs/cli/get-started/",
        "CONFIG",
      );
    }

    const message = err.stderr ?? (error instanceof Error ? error.message : String(error));

    throw new KaryaError(`Failed to resolve 1Password reference: ${message}`, "CONFIG");
  }
}
