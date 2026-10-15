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

export function resolveSameTv(candidates: TvCandidate[], stored: StoredTv): TvCandidate | null {
  if (candidates.length === 0) return null;
  const sameHost = candidates.find((tv) => tv.host === stored.host);
  if (sameHost) return sameHost;

  const wanted = normalizeName(stored.name || "");
  if (!wanted) return candidates.length === 1 ? candidates[0] : null;

  const byName = candidates.filter((tv) => normalizeName(tv.name || "") === wanted);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    const storedModel = wanted;
    const byModel = byName.filter((tv) => normalizeName(tv.model || tv.name || "") === storedModel);
    if (byModel.length === 1) return byModel[0];
    return null;
  }
  return null;
}
