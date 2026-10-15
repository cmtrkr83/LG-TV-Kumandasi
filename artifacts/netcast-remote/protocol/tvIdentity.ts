export type TvCandidate = {
  id: string;
  host: string;
  name: string;
  model?: string;
};

export type StoredTv = {
  host: string;
  name: string;
};

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("tr").replace(/\s+/g, " ");
}

export function resolveSameTv(
  candidates: TvCandidate[],
  stored: StoredTv,
): TvCandidate | null {
  if (candidates.length === 0) return null;
  const wanted = normalizeName(stored.name || "");
  const sameHost = candidates.find((tv) => tv.host === stored.host);
  if (sameHost) {
    if (!wanted) return sameHost;
    return normalizeName(sameHost.name || "") === wanted ? sameHost : null;
  }
  if (!wanted) return null;

  const byName = candidates.filter(
    (tv) => normalizeName(tv.name || "") === wanted,
  );
  if (byName.length === 1) return byName[0];
  return null;
}
