// Reading files that another process (Ichitaro, or a process on the other side
// of a shared folder) may still hold open. On Windows such a sharing violation reaches Node as
// EBUSY, EPERM or EACCES; it is retried up to a limit instead of being treated as
// an unknown outcome. ENOENT is not a sharing violation and is returned at once.
import * as fs from 'node:fs/promises';

export const SHARING_VIOLATIONS = Object.freeze(new Set(['EBUSY', 'EPERM', 'EACCES']));
export const isSharingViolation = error => SHARING_VIOLATIONS.has(error?.code);
export const RETRY_LIMIT_MS = 15000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * fs.readFile with sharing violations retried for up to limitMs. When the limit
 * is reached the last error is thrown with retriedMs and code unchanged, so a
 * caller can tell an exhausted retry (isSharingViolation) from other errors.
 */
export async function readFileRetry(file, encoding, { limitMs = RETRY_LIMIT_MS, intervalMs = 100, read = fs.readFile } = {}) {
  const started = Date.now();
  for (;;) {
    try { return await read(file, encoding); }
    catch (error) {
      if (!isSharingViolation(error)) throw error;
      if (Date.now() - started >= limitMs) throw Object.assign(error, { retriedMs: Date.now() - started });
      await pause(intervalMs);
    }
  }
}

/** Any file operation (a rename on a shared folder, for example) with sharing violations retried the same way. */
export async function retrySharing(operation, { limitMs = RETRY_LIMIT_MS, intervalMs = 100 } = {}) {
  return readFileRetry(null, undefined, { limitMs, intervalMs, read: () => operation() });
}
