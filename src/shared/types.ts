import type { SyncWarning } from "../core/git-sync.js";

export type WriteResult<T> = {
  result: T;
  warnings: SyncWarning[];
};
