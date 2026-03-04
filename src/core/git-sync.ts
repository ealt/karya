import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { simpleGit, type SimpleGit } from "simple-git";
import { KaryaError } from "./errors.js";

export interface SyncWarning {
  code: "OFFLINE" | "NO_UPSTREAM" | "CONFLICT" | "UNKNOWN";
  message: string;
}

export interface SyncResult {
  warnings: SyncWarning[];
  committed: boolean;
  pushed: boolean;
}

function isNoUpstreamError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  return message.includes("no tracking information") || message.includes("no upstream configured");
}

function isNetworkError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return (
    message.includes("could not resolve host") ||
    message.includes("unable to access") ||
    message.includes("failed to connect") ||
    message.includes("network")
  );
}

function isNonFastForward(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error).toLowerCase();
  return message.includes("non-fast-forward") || message.includes("fetch first") || message.includes("rejected");
}

export class GitSync {
  private git: SimpleGit | null = null;
  private readonly lockPath: string;

  constructor(
    private readonly dataDir: string,
    private readonly authorName = "karya",
  ) {
    this.lockPath = join(dataDir, ".karya.lock");
  }

  async initRepo(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.lockPath, "", { flag: "a" });

    const git = this.getGit();
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      await git.init();
    }

    await this.ensureGitIdentity();
  }

  async syncWithRetries(retries = 3): Promise<SyncResult> {
    const warnings: SyncWarning[] = [];
    let pushed = false;
    const git = this.getGit();

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await this.pullRebase(warnings);
        await git.push();
        pushed = true;
        break;
      } catch (error) {
        if (isNoUpstreamError(error)) {
          warnings.push({
            code: "NO_UPSTREAM",
            message: "No upstream branch configured; created local commits only.",
          });
          break;
        }

        if (isNetworkError(error)) {
          warnings.push({
            code: "OFFLINE",
            message: "Network unavailable; changes remain local until next sync.",
          });
          break;
        }

        if (isNonFastForward(error) && attempt < retries) {
          continue;
        }

        throw new KaryaError(`Git sync failed: ${String((error as { message?: string })?.message ?? error)}`, "SYNC");
      }
    }

    return {
      warnings,
      committed: false,
      pushed,
    };
  }

  async runWriteCycle<T>(
    operation: () => Promise<T>,
    commitMessage: string,
    retries = 3,
  ): Promise<{ result: T; sync: SyncResult }> {
    await this.initRepo();
    const release = await lockfile.lock(this.lockPath, {
      retries: {
        retries: 4,
        factor: 1.4,
        minTimeout: 50,
      },
      realpath: false,
    });

    const git = this.getGit();

    try {
      const warnings: SyncWarning[] = [];
      await this.pullRebase(warnings);

      const result = await operation();

      const status = await git.status();
      const hasChanges = status.files.length > 0;
      if (hasChanges) {
        await git.add(".");
        await git.commit(commitMessage);
      }

      const sync = await this.pushWithRetry(warnings, retries);

      return {
        result,
        sync: {
          ...sync,
          committed: hasChanges,
        },
      };
    } finally {
      await release();
    }
  }

  private getGit(): SimpleGit {
    if (this.git) {
      return this.git;
    }

    this.git = simpleGit({ baseDir: this.dataDir });
    return this.git;
  }

  private async pullRebase(warnings: SyncWarning[]): Promise<void> {
    try {
      await this.getGit().pull(["--rebase", "--autostash"]);
    } catch (error) {
      if (isNoUpstreamError(error)) {
        warnings.push({
          code: "NO_UPSTREAM",
          message: "No upstream branch configured; operating on local branch.",
        });
        return;
      }
      if (isNetworkError(error)) {
        warnings.push({
          code: "OFFLINE",
          message: "Network unavailable; operating locally.",
        });
        return;
      }
      throw error;
    }
  }

  private async pushWithRetry(warnings: SyncWarning[], retries: number): Promise<SyncResult> {
    const git = this.getGit();

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        await git.push();
        return { warnings, committed: false, pushed: true };
      } catch (error) {
        if (isNoUpstreamError(error)) {
          warnings.push({
            code: "NO_UPSTREAM",
            message: "No upstream branch configured; created local commits only.",
          });
          return { warnings, committed: false, pushed: false };
        }

        if (isNetworkError(error)) {
          warnings.push({
            code: "OFFLINE",
            message: "Network unavailable; changes remain local until next sync.",
          });
          return { warnings, committed: false, pushed: false };
        }

        if (isNonFastForward(error) && attempt < retries) {
          await this.pullRebase(warnings);
          continue;
        }

        throw new KaryaError(`Git push failed: ${String((error as { message?: string })?.message ?? error)}`, "SYNC");
      }
    }

    return {
      warnings: [...warnings, { code: "UNKNOWN", message: "Push retries exceeded." }],
      committed: false,
      pushed: false,
    };
  }

  private async ensureGitIdentity(): Promise<void> {
    const git = this.getGit();
    const [nameConfigured, emailConfigured] = await Promise.all([
      this.getGitConfigValue("user.name"),
      this.getGitConfigValue("user.email"),
    ]);

    if (!nameConfigured) {
      await git.addConfig("user.name", this.authorName, false, "local");
    }

    if (!emailConfigured) {
      const safe = this.authorName.replaceAll(/[^a-zA-Z0-9._-]/g, "-") || "karya";
      await git.addConfig("user.email", `${safe}@karya.local`, false, "local");
    }
  }

  private async getGitConfigValue(key: string): Promise<string | null> {
    try {
      const result = await this.getGit().raw(["config", "--get", key]);
      const value = result.trim();
      return value.length > 0 ? value : null;
    } catch {
      return null;
    }
  }
}
