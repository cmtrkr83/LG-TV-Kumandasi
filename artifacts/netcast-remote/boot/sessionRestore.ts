import type { NetcastErrorKind } from "../protocol/netcast";

export type StoredStatus = "missing" | "invalid" | "ready";

export const BOOT_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

export const MAX_FONT_MULTIPLIER = 1.2;

export function shouldShowRemoteShell(
  status: StoredStatus,
  hasStoredHost: boolean,
): boolean {
  return status === "ready" && hasStoredHost;
}

export function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isRetryableRestoreError(kind: NetcastErrorKind): boolean {
  return kind === "transient" || kind === "timeout" || kind === "network";
}

export function getCommandAvailability(hasSession: boolean): {
  enabled: boolean;
  statusKey: "status.connectionReady" | "status.storedTvSearching";
} {
  if (hasSession) return { enabled: true, statusKey: "status.connectionReady" };
  return { enabled: true, statusKey: "status.storedTvSearching" };
}
