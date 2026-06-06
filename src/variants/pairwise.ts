/**
 * Deterministic greedy all-pairs (pairwise) covering array. Given parameters
 * each with a set of candidate values, returns test cases such that every pair
 * of values from every pair of parameters appears in at least one case — far
 * fewer than the full Cartesian product, but full pairwise interaction coverage.
 *
 * Seeded by always taking the first still-uncovered pair, so it terminates and
 * is fully deterministic (no randomness).
 */
export interface PairwiseParam<T> {
  name: string;
  values: T[];
}

const pairKey = (i: number, vi: number, j: number, vj: number): string => `${i}=${vi}&${j}=${vj}`;

export function pairwise<T>(params: PairwiseParam<T>[]): Array<Record<string, T>> {
  const n = params.length;
  if (n === 0 || params.some((p) => p.values.length === 0)) {
    return [];
  }
  if (n === 1) {
    const only = params[0] as PairwiseParam<T>;
    return only.values.map((v) => ({ [only.name]: v }));
  }

  const valIdx = params.map((p) => p.values.map((_, k) => k));
  const uncovered = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (const a of valIdx[i] as number[]) {
        for (const b of valIdx[j] as number[]) {
          uncovered.add(pairKey(i, a, j, b));
        }
      }
    }
  }

  const results: Array<Record<string, T>> = [];
  let guard = 0;

  while (uncovered.size > 0 && guard++ < 5000) {
    const seed = uncovered.values().next().value as string;
    const [lhs, rhs] = seed.split("&");
    const [si, sa] = (lhs as string).split("=").map(Number);
    const [sj, sb] = (rhs as string).split("=").map(Number);

    const assign = new Array<number>(n).fill(-1);
    assign[si as number] = sa as number;
    assign[sj as number] = sb as number;

    for (let i = 0; i < n; i++) {
      if (assign[i] !== -1) continue;
      let bestVal = (valIdx[i] as number[])[0] as number;
      let bestGain = -1;
      for (const cand of valIdx[i] as number[]) {
        let gain = 0;
        for (let p = 0; p < n; p++) {
          if (p === i || assign[p] === -1) continue;
          const lo = Math.min(p, i);
          const hi = Math.max(p, i);
          const loV = lo === p ? (assign[p] as number) : cand;
          const hiV = hi === p ? (assign[p] as number) : cand;
          if (uncovered.has(pairKey(lo, loV, hi, hiV))) gain++;
        }
        if (gain > bestGain) {
          bestGain = gain;
          bestVal = cand;
        }
      }
      assign[i] = bestVal;
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        uncovered.delete(pairKey(i, assign[i] as number, j, assign[j] as number));
      }
    }

    const rec: Record<string, T> = {};
    for (let i = 0; i < n; i++) {
      const p = params[i] as PairwiseParam<T>;
      rec[p.name] = p.values[assign[i] as number] as T;
    }
    results.push(rec);
  }

  return results;
}
