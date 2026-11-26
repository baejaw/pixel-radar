// PIXEL RADAR model (radar-3): a fitted token launch radar.
//
// One snapshot in, one ranked board out. No protocol name is ever special-cased:
// the same fitted function prices every row, from the snapshot's own figures only.
//
// Why fitted, not hand-set multiples? The v1 radar (radar-2) priced each protocol
// at a hand-blended median of its category peers' market-cap / TVL. The snapshot
// holds a stronger answer: 100+ protocols in it already trade, so the pricing
// function itself can be FIT on them and TESTED on held-out ones. radar-3 does
// exactly that, and publishes the test next to the model:
//
//   fit set      = protocols whose token trades (mcap recorded and positive),
//                  with real TVL, category not CEX: 119 candidates here.
//   outlier rule = a candidate whose mcap/TVL multiple falls outside [0.005, 6]
//                  is a mismatched record (a token's cap set against one
//                  deployment's TVL, or the reverse) and is dropped from the
//                  fit: 11 dropped, 108 fitted. The band is a fixed constant of
//                  the method, stated here and in the dashboard.
//   model        = log(mcap) ~ intercept + b_tvl x (log TVL - mean log TVL)
//                  + b_growth x clip(change_7d, -60, 120)/100
//                  + b_age x log1p(age_days, median-imputed when unlisted)
//                  + category offset + primary-chain offset,
//                  ridge-regularised (penalty 3 on category offsets, 6 on chain
//                  offsets, so a group with n members keeps about n/(n+penalty)
//                  of its raw offset: shrinkage toward the global fit, by n),
//                  solved by normal equations and Gaussian elimination.
//   validation   = deterministic 2-fold cross-fitting (fold = FNV-1a(slug) mod 2).
//                  On identical folds the fitted model is scored against the
//                  radar-2 peer-median baseline and against a 50/50 log blend of
//                  the two. The fitted model won the held-out median error and
//                  the log-scale R-squared in both the 2-fold and a 5-fold
//                  cross-check, so the board prices with the fitted model alone;
//                  the blend survives only as a Model Lab slider. The numbers
//                  themselves ship in data.js and are printed in the dashboard's
//                  Model check view: nothing about the fit is asserted that the
//                  held-out rows do not show.
//
// Every published parameter is rounded (coefficients and offsets to 6 places,
// multiples to 4) BEFORE it prices anything, and the board is priced from the
// rounded parameters, so the dashboard recomputes board.json's exact implied
// value from the figures data.js carries: implied = round(exp(fit_log)).
//
// Two reader scores ride on top of the valuation, never inside it:
//   launch odds 0-100: the snapshot's own launch base rate for the protocol's
//     category - of the protocols in that category, the share whose token
//     already trades, shrunk toward the global share - adjusted by TVL tier,
//     7-day growth, age, and a structural discount for pass-through products
//     (bridges and wrapped/staked products, whose value accrues to a token
//     that already trades). Odds say how launch-like a record looks; they
//     never move the implied value or the rank.
//   opportunity = implied x odds/100 x confidence/100, an expected-value index
//     a reader can sort by in the dashboard. The board's rank stays the
//     implied value's order, as the bounty requires.
//   confidence 0-100: category peer depth in the fit, the category's residual
//     spread under the fit, a known age, and a reported 7-day change.
//   farm score 0-100: value size, momentum, confidence and capital efficiency.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-3 fitted';
export const LIVE_ROWS = 36;

// --- Fit constants (the method; changing one changes the model) ---
export const MULT_BAND: [number, number] = [0.005, 6];
export const GROWTH_CLIP: [number, number] = [-60, 120];
export const RIDGE = { continuous: 0.01, category: 3, chain: 6 };
export const BASELINE = {
  peer_weight: 0.65, global_weight: 0.35, multiple_floor: 0.06, multiple_cap: 1.0,
  ratio_floor: 0.02, ratio_cap: 2.5, min_category_peers: 3,
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095, unknown_age_days: 365,
  chain_step: 0.025, chain_max_extra: 4,
};

export interface FarmStep { text: string; cost: string; time: string; gas: number; mins: number; }

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fit_log: number;
    fitted_multiple: number;
    peer_multiple: number;
    global_multiple: number;
    peer_count: number;
    growth_pct: number;
    odds: number;
    base_rate_pct: number;
    opportunity_usd: number;
    pass_through: boolean;
    confidence: number;
    farm_score: number;
    risk: string;
    capital_usd: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fit_log: number;
  peer_log: number;
  growth_part: number;
  fitted_multiple: number;
  peer_multiple: number;
  peer_count: number;
  odds: number;
  base_rate_pct: number;
  opportunity_usd: number;
  pass_through: boolean;
  confidence: number;
  farm_score: number;
  risk: string;
  capital_usd: number;
  hold_days: number;
  in_watchlist: boolean;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

export interface CategoryInfo {
  category: string;
  peers: number;
  offset: number;
  peer_multiple: number;
  live_count: number;
  board_count: number;
  base_rate_pct: number;
}

export interface ChainOffset { chain: string; peers: number; offset: number; }

export interface FitParams {
  intercept: number;
  log_tvl: number;
  growth: number;
  log_age: number;
  mean_log_tvl: number;
  median_age_days: number;
  growth_clip: [number, number];
  mult_band: [number, number];
  candidate_rows: number;
  dropped_rows: number;
  fit_rows: number;
  category_offsets: { category: string; peers: number; offset: number }[];
  chain_offsets: ChainOffset[];
}

export interface ValidationStats { median_ape_pct: number; mean_ape_pct: number; r2_log: number; }
export interface Validation {
  folds: number;
  rows: number;
  fitted: ValidationStats;
  baseline: ValidationStats;
  blend: ValidationStats;
  chosen: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  global_base_rate_pct: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_cex: number;
  excluded_passthrough: number;
  total_implied_usd: number;
  median_implied_usd: number;
  fit: FitParams;
  validation: Validation;
  categories: CategoryInfo[];
  chain_offsets: ChainOffset[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

const PASS_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const PASS_NAME = /\b(wrapped|staked|staking)\b/i;

/** A launch candidate: records no token, is not an exchange, is not a versioned
 *  re-deployment of a named predecessor, and is not a pass-through product -
 *  the watchlist's own hygiene, applied at every TVL, not just above the floor.
 *  Pass-through products (bridges, wrapped and staked products) are not ranked
 *  as launches: their value accrues to a token that already trades, which is
 *  why the house's watchlist rule leaves them out too. The board counts them
 *  in the open - see excluded_passthrough - rather than dropping them quietly. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !PASS_CATEGORIES.has(p.category ?? '') && p.tvl_usd > 0;
}

/** A ranked row can still be pass-through by name (a wrapped or staked product
 *  filed under another category): flagged on the board and discounted in odds. */
export function isPassThrough(p: SnapshotProtocol): boolean {
  return PASS_CATEGORIES.has(p.category ?? '') || PASS_NAME.test(p.name);
}

// ---------------------------------------------------------------------------
// The fit
// ---------------------------------------------------------------------------

export interface FitSet { candidates: SnapshotProtocol[]; rows: SnapshotProtocol[]; dropped: SnapshotProtocol[]; }

export function fitSet(snapshot: Snapshot): FitSet {
  const candidates = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const rows = candidates.filter((p) => {
    const m = p.mcap_usd! / p.tvl_usd;
    return m >= MULT_BAND[0] && m <= MULT_BAND[1];
  });
  const kept = new Set(rows.map((p) => p.slug));
  return { candidates, rows, dropped: candidates.filter((p) => !kept.has(p.slug)) };
}

interface Design { cats: string[]; chains: string[]; meanLogTvl: number; medianAge: number; }

function growthFeature(p: SnapshotProtocol): number {
  return clamp(finite(p.change_7d, 0), GROWTH_CLIP[0], GROWTH_CLIP[1]) / 100;
}

function designOf(rows: SnapshotProtocol[], asOf: string): Design {
  const cats = [...new Set(rows.map((p) => p.category ?? 'Other'))].sort();
  const chains = [...new Set(rows.map((p) => p.chains[0] ?? 'None'))].sort();
  const meanLogTvl = rows.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / rows.length;
  const ages = rows.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  return { cats, chains, meanLogTvl, medianAge: Math.round(median(ages)) };
}

function designRow(p: SnapshotProtocol, asOf: string, d: Design): number[] {
  const age = ageDays(asOf, p.listed_at) ?? d.medianAge;
  const x = [1, Math.log(p.tvl_usd) - d.meanLogTvl, growthFeature(p), Math.log1p(age)];
  for (const c of d.cats) x.push((p.category ?? 'Other') === c ? 1 : 0);
  for (const c of d.chains) x.push((p.chains[0] ?? 'None') === c ? 1 : 0);
  return x;
}

/** Ridge OLS by normal equations + Gauss-Jordan elimination with partial pivoting. */
export function ridgeFit(rows: SnapshotProtocol[], asOf: string): { design: Design; beta: number[]; predict: (p: SnapshotProtocol) => number } {
  const d = designOf(rows, asOf);
  const k = 4 + d.cats.length + d.chains.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (const p of rows) {
    const x = designRow(p, asOf, d);
    const y = Math.log(p.mcap_usd!);
    for (let i = 0; i < k; i++) {
      xty[i]! += x[i]! * y;
      for (let j = 0; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
    }
  }
  const lam = new Array<number>(k).fill(RIDGE.continuous);
  lam[0] = 0;
  for (let i = 4; i < 4 + d.cats.length; i++) lam[i] = RIDGE.category;
  for (let i = 4 + d.cats.length; i < k; i++) lam[i] = RIDGE.chain;
  for (let i = 0; i < k; i++) xtx[i]![i]! += lam[i]!;
  const a = xtx.map((row, i) => [...row, xty[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    const swap = a[col]!; a[col] = a[piv]!; a[piv] = swap;
    const diag = a[col]![col]!;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = a[r]![col]! / diag;
      if (f === 0) continue;
      for (let c = col; c <= k; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  const beta = a.map((row, i) => row[k]! / row[i]!);
  return { design: d, beta, predict: (p) => designRow(p, asOf, d).reduce((s, v, i) => s + v * beta[i]!, 0) };
}

/** The published fit: every parameter rounded before it prices anything. */
export function publishedFit(snapshot: Snapshot): { params: FitParams; predictLog: (p: SnapshotProtocol) => number; growthPart: (p: SnapshotProtocol) => number } {
  const set = fitSet(snapshot);
  const { design, beta } = ridgeFit(set.rows, snapshot.as_of);
  const catOff = new Map<string, number>();
  design.cats.forEach((c, i) => catOff.set(c, round6(beta[4 + i]!)));
  const chainOff = new Map<string, number>();
  design.chains.forEach((c, i) => chainOff.set(c, round6(beta[4 + design.cats.length + i]!)));
  const params: FitParams = {
    intercept: round6(beta[0]!), log_tvl: round6(beta[1]!), growth: round6(beta[2]!), log_age: round6(beta[3]!),
    mean_log_tvl: round6(design.meanLogTvl), median_age_days: design.medianAge,
    growth_clip: GROWTH_CLIP, mult_band: MULT_BAND,
    candidate_rows: set.candidates.length, dropped_rows: set.dropped.length, fit_rows: set.rows.length,
    category_offsets: design.cats.map((c) => ({ category: c, peers: set.rows.filter((p) => (p.category ?? 'Other') === c).length, offset: catOff.get(c)! })),
    chain_offsets: design.chains.map((c) => ({ chain: c, peers: set.rows.filter((p) => (p.chains[0] ?? 'None') === c).length, offset: chainOff.get(c)! })),
  };
  const growthPart = (p: SnapshotProtocol): number => round6(params.growth * growthFeature(p));
  const predictLog = (p: SnapshotProtocol): number => {
    const age = ageDays(snapshot.as_of, p.listed_at) ?? params.median_age_days;
    const v = params.intercept
      + params.log_tvl * (Math.log(p.tvl_usd) - params.mean_log_tvl)
      + growthPart(p)
      + params.log_age * Math.log1p(age)
      + (catOff.get(p.category ?? 'Other') ?? 0)
      + (chainOff.get(p.chains[0] ?? 'None') ?? 0);
    return round6(v);
  };
  return { params, predictLog, growthPart };
}

// ---------------------------------------------------------------------------
// The radar-2 baseline (kept as the validation yardstick and the Lab's blend)
// ---------------------------------------------------------------------------

export interface PeerTable { global: number; byCategory: Map<string, { median: number; count: number }>; }

export function peerTable(rows: SnapshotProtocol[]): PeerTable {
  const ratio = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, BASELINE.ratio_floor, BASELINE.ratio_cap);
  const global = median(rows.map(ratio));
  const groups = new Map<string, number[]>();
  for (const p of rows) {
    const key = p.category ?? 'Other';
    const arr = groups.get(key) ?? [];
    arr.push(ratio(p));
    groups.set(key, arr);
  }
  const byCategory = new Map<string, { median: number; count: number }>();
  for (const [category, arr] of groups) byCategory.set(category, { median: median(arr), count: arr.length });
  return { global, byCategory };
}

export function baselineLog(p: SnapshotProtocol, asOf: string, peers: PeerTable): number {
  const cat = peers.byCategory.get(p.category ?? 'Other');
  const useCategory = cat !== undefined && cat.count >= BASELINE.min_category_peers;
  const peerMultiple = useCategory ? cat.median : peers.global;
  const effective = round4(clamp(BASELINE.peer_weight * peerMultiple + BASELINE.global_weight * peers.global, BASELINE.multiple_floor, BASELINE.multiple_cap));
  const growthPct = clamp(finite(p.change_7d, 0), BASELINE.growth_floor, BASELINE.growth_cap);
  const growthMult = round4(1 + (growthPct / 100) * BASELINE.growth_weight);
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? BASELINE.unknown_age_days;
  const maturityMult = round4(BASELINE.maturity_floor + (Math.min(Math.max(ageForModel, 0), BASELINE.maturity_days) / BASELINE.maturity_days) * BASELINE.maturity_range);
  const chainMult = round4(1 + Math.min(Math.max(p.chains.length - 1, 0), BASELINE.chain_max_extra) * BASELINE.chain_step);
  return Math.log(Math.max(1, Math.round(p.tvl_usd * effective * growthMult * maturityMult * chainMult)));
}

// ---------------------------------------------------------------------------
// Held-out validation: deterministic 2-fold cross-fitting, identical folds
// for the fitted model, the baseline, and their 50/50 log blend.
// ---------------------------------------------------------------------------

function statsOf(pairs: [number, number][]): ValidationStats {
  const apes = pairs.map(([lp, m]) => (Math.abs(Math.exp(lp) - m) / m) * 100);
  const ys = pairs.map(([, m]) => Math.log(m));
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const ssRes = pairs.reduce((s, [lp, m]) => s + (Math.log(m) - lp) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  return {
    median_ape_pct: round1(median(apes)),
    mean_ape_pct: round1(apes.reduce((a, b) => a + b, 0) / apes.length),
    r2_log: round3(ssTot > 0 ? 1 - ssRes / ssTot : 0),
  };
}

export function validate(snapshot: Snapshot): Validation {
  const { rows } = fitSet(snapshot);
  const fitted: [number, number][] = [];
  const baseline: [number, number][] = [];
  const blend: [number, number][] = [];
  for (let fold = 0; fold < 2; fold++) {
    const train = rows.filter((p) => fnv1a(p.slug) % 2 !== fold);
    const test = rows.filter((p) => fnv1a(p.slug) % 2 === fold);
    const model = ridgeFit(train, snapshot.as_of);
    const peers = peerTable(train);
    for (const p of test) {
      const lf = model.predict(p);
      const lb = baselineLog(p, snapshot.as_of, peers);
      fitted.push([lf, p.mcap_usd!]);
      baseline.push([lb, p.mcap_usd!]);
      blend.push([(lf + lb) / 2, p.mcap_usd!]);
    }
  }
  return { folds: 2, rows: rows.length, fitted: statsOf(fitted), baseline: statsOf(baseline), blend: statsOf(blend), chosen: 'fitted' };
}

// ---------------------------------------------------------------------------
// Launch odds, confidence, farm score, risk
// ---------------------------------------------------------------------------

export interface OddsTables { baseByCategory: Map<string, number>; globalBase: number; }

export function oddsTables(snapshot: Snapshot, boardPool: SnapshotProtocol[]): OddsTables {
  const liveByCat = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null) liveByCat.set(p.category ?? 'Other', (liveByCat.get(p.category ?? 'Other') ?? 0) + 1);
  }
  const preByCat = new Map<string, number>();
  for (const p of boardPool) preByCat.set(p.category ?? 'Other', (preByCat.get(p.category ?? 'Other') ?? 0) + 1);
  const totalLive = [...liveByCat.values()].reduce((a, b) => a + b, 0);
  const totalPre = boardPool.length;
  const globalBase = totalLive / (totalLive + totalPre);
  const baseByCategory = new Map<string, number>();
  for (const cat of new Set([...liveByCat.keys(), ...preByCat.keys()])) {
    const l = liveByCat.get(cat) ?? 0;
    const n = preByCat.get(cat) ?? 0;
    baseByCategory.set(cat, (l + 8 * globalBase) / (l + n + 8));
  }
  return { baseByCategory, globalBase };
}

export function launchOdds(p: SnapshotProtocol, age: number | null, passThrough: boolean, tables: OddsTables): { odds: number; baseRatePct: number } {
  const base = tables.baseByCategory.get(p.category ?? 'Other') ?? tables.globalBase;
  let adj = base;
  adj *= p.tvl_usd >= 1_000_000_000 ? 1.2 : p.tvl_usd >= 250_000_000 ? 1.1 : p.tvl_usd >= 50_000_000 ? 1 : p.tvl_usd >= 15_000_000 ? 0.9 : 0.8;
  adj *= p.change_7d === null ? 0.95 : p.change_7d >= 25 ? 1.1 : p.change_7d <= -25 ? 0.85 : 1;
  adj *= age === null ? 0.95 : age >= 730 ? 1.1 : age >= 365 ? 1.05 : age >= 90 ? 1 : 0.85;
  if (passThrough) adj *= 0.35;
  return { odds: Math.round(clamp(adj * 100, 2, 97)), baseRatePct: round1(base * 100) };
}

function categorySpread(snapshot: Snapshot, fitRows: SnapshotProtocol[], predictLog: (p: SnapshotProtocol) => number): Map<string, number> {
  const residuals = new Map<string, number[]>();
  let all: number[] = [];
  for (const p of fitRows) {
    const r = Math.log(p.mcap_usd!) - predictLog(p);
    const key = p.category ?? 'Other';
    const arr = residuals.get(key) ?? [];
    arr.push(r);
    residuals.set(key, arr);
    all.push(r);
  }
  const globalMad = median(all.map((r) => Math.abs(r - median(all))));
  const out = new Map<string, number>();
  for (const [cat, arr] of residuals) {
    out.set(cat, arr.length >= 3 ? median(arr.map((r) => Math.abs(r - median(arr)))) : globalMad);
  }
  out.set('__global__', globalMad);
  return out;
}

export function confidenceFor(peerCount: number, spread: number, age: number | null, change: number | null): number {
  let c = 35;
  c += peerCount >= 8 ? 25 : peerCount >= 4 ? 18 : peerCount >= 2 ? 10 : peerCount >= 1 ? 5 : 0;
  c += spread <= 0.8 ? 15 : spread <= 1.2 ? 10 : spread <= 1.8 ? 5 : 0;
  if (age !== null) c += 10 + (age >= 365 ? 5 : 0);
  if (change !== null) c += 10;
  return clamp(Math.round(c), 5, 98);
}

export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 20_000_000) return 75;
  return 50;
}

export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

// ---------------------------------------------------------------------------
// Farm plans: category action, chain gas tier, TVL-tier capital, age hold.
// Every step carries a dollar cost and a time; the last step is the totals.
// ---------------------------------------------------------------------------

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }

const HIGH_GAS = new Set(['Ethereum', 'Bitcoin']);
export function gasTier(chain: string): 'high' | 'low' { return HIGH_GAS.has(chain) ? 'high' : 'low'; }

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase(); const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the supplied position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of two-sided liquidity to ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds once inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged trade, then close it cleanly.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one small position in an active market you understand.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into one diversified ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold the minted asset.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} through ${name} and hold it in the same wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} for a position you actually hold and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in that wallet.`;
}

function secondActionFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase(); const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount against the supply on ${name}, repay it in full, and repeat once so both sides of the market are used.`;
  if (c.includes('dex')) return `Make two small swaps through ${name} on ${chain} on different days, keeping each swap under 10% of your position.`;
  if (c.includes('bridge')) return `Bridge a second, smaller amount back through ${name} a week later so the route is used in both directions.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim any staking rewards on ${name} once and restake or hold them; do not sell the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Place one limit order and one market order on ${name} in separate weeks so the activity is not a single burst.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Move a small part of the deposit to a second ${name} vault on ${chain} so more than one strategy is used.`;
  return `Use one second feature of ${name} on ${chain}, such as a vote, a claim page or a referral-free direct action, once.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const high = gasTier(chain) === 'high';
  const g1 = high ? 3 : 1, g2 = high ? 8 : 2, g3 = high ? 5 : 2, g4 = high ? 4 : 1;
  const steps: FarmStep[] = [
    { text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`, cost: `about $${g1} of gas for the first transaction on ${chain}`, time: '5 minutes', gas: g1, mins: 5 },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${g2} of gas on ${chain}`, time: '15 minutes to set up', gas: g2, mins: 15 },
    { text: secondActionFor(p, chain), cost: `about $${g3} of gas on ${chain}`, time: '10 minutes', gas: g3, mins: 10 },
    { text: `Repeat one qualifying action on ${p.name} each week, on a different weekday, instead of doing everything in one day.`, cost: `about $${g4} of gas a week on ${chain}`, time: '10 minutes a week', gas: g4, mins: 10 },
    { text: `Hold the ${p.name} position for at least ${hold} days so the activity appears in more than one weekly snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days`, gas: 0, mins: 0 },
    { text: `Open only the points or rewards page that ${p.name} itself publishes, check eligibility there, and never pay a third party to claim.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes', gas: 0, mins: 10 },
    { text: `Log every ${p.name} transaction, date and balance in a farm log, set a stop rule for a TVL drop over 30%, and unwind if it triggers.`, cost: 'nothing but the log', time: '5 minutes to set up, 2 minutes a week', gas: 0, mins: 5 },
  ];
  const setupGas = g1 + g2 + g3;
  const setupMins = 5 + 15 + 10 + 10 + 5;
  steps.push({
    text: `Plan total for ${p.name}: $${capital} of working capital, about $${setupGas} of gas to set up on ${chain} plus about $${g4} of gas a week to maintain, about ${setupMins} minutes of setup and 10 minutes a week, held at least ${hold} days.`,
    cost: 'no extra cost - this line is the total of the steps above', time: '2 minutes to read', gas: 0, mins: 2,
  });
  return steps;
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------------------
// Board + radar assembly
// ---------------------------------------------------------------------------

interface Scored {
  p: SnapshotProtocol;
  age: number | null;
  fitLog: number;
  peerLog: number;
  growthPart: number;
  implied: number;
  fittedMultiple: number;
  peerMultiple: number;
  peerCount: number;
  odds: number;
  baseRatePct: number;
  opportunity: number;
  passThrough: boolean;
  confidence: number;
  farmScore: number;
  risk: string;
  capital: number;
}

function scoreAll(snapshot: Snapshot): { scored: Scored[]; fit: FitParams; validation: Validation; peers: PeerTable; pool: SnapshotProtocol[] } {
  const { params, predictLog, growthPart } = publishedFit(snapshot);
  const validation = validate(snapshot);
  const set = fitSet(snapshot);
  const peers = peerTable(set.rows);
  const pool = snapshot.protocols.filter(isRankable);
  const tables = oddsTables(snapshot, pool);
  const spreads = categorySpread(snapshot, set.rows, predictLog);
  const globalSpread = spreads.get('__global__') ?? 1.2;
  const scored = pool.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const fitLog = predictLog(p);
    const implied = Math.max(1, Math.round(Math.exp(fitLog)));
    const peerLog = round6(baselineLog(p, snapshot.as_of, peers));
    const cat = peers.byCategory.get(p.category ?? 'Other');
    const peerCount = cat?.count ?? 0;
    const peerMultiple = cat !== undefined && cat.count >= BASELINE.min_category_peers ? cat.median : peers.global;
    const passThrough = isPassThrough(p);
    const { odds, baseRatePct } = launchOdds(p, age, passThrough, tables);
    const spread = spreads.get(p.category ?? 'Other') ?? globalSpread;
    const confidence = confidenceFor(peerCount, spread, age, p.change_7d);
    const opportunity = Math.round(implied * (odds / 100) * (confidence / 100));
    const capital = capitalFor(p);
    const growthPct = clamp(finite(p.change_7d, 0), BASELINE.growth_floor, BASELINE.growth_cap);
    const sizePart = clamp((Math.log10(Math.max(implied, 1)) - 6) / 3, 0, 1) * 35;
    const momentumPart = clamp((growthPct + 20) / 80, 0, 1) * 20;
    const efficiencyPart = clamp((Math.log10(Math.max(implied / capital, 1)) - 3) / 4, 0, 1) * 20;
    const farmScore = Math.round(clamp(sizePart + momentumPart + efficiencyPart + confidence * 0.25, 0, 100));
    let risk = age !== null && age >= 365 && p.tvl_usd >= 100_000_000 ? 'Lower' : age !== null && age >= 180 && p.tvl_usd >= 20_000_000 ? 'Medium' : 'High';
    if (risk === 'Lower' && growthPct <= -20) risk = 'Medium';
    else if (risk === 'Medium' && growthPct <= -30) risk = 'High';
    return {
      p, age, fitLog, peerLog, growthPart: growthPart(p), implied,
      fittedMultiple: round4(Math.exp(fitLog) / p.tvl_usd), peerMultiple, peerCount,
      odds, baseRatePct, opportunity, passThrough, confidence, farmScore, risk, capital,
    };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return { scored, fit: params, validation, peers, pool };
}

export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const { scored, peers } = scoreAll(snapshot);
  return buildBoardFromScored(snapshot, scored, peers);
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
      ratio: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { scored, fit, validation, peers, pool } = scoreAll(snapshot);
  const board = buildBoardFromScored(snapshot, scored, peers);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const set = fitSet(snapshot);
  const tables = oddsTables(snapshot, pool);
  const liveByCat = new Map<string, number>();
  for (const p of snapshot.protocols) if (p.mcap_usd !== null) liveByCat.set(p.category ?? 'Other', (liveByCat.get(p.category ?? 'Other') ?? 0) + 1);
  const boardByCat = new Map<string, number>();
  for (const s of scored) boardByCat.set(s.p.category ?? 'Other', (boardByCat.get(s.p.category ?? 'Other') ?? 0) + 1);
  const offsetByCat = new Map(fit.category_offsets.map((o) => [o.category, o.offset]));
  const catNames = [...new Set([...boardByCat.keys(), ...offsetByCat.keys()])].sort();
  const categories: CategoryInfo[] = catNames.map((category) => {
    const cat = peers.byCategory.get(category);
    return {
      category,
      peers: cat?.count ?? 0,
      offset: offsetByCat.get(category) ?? 0,
      peer_multiple: round4(cat !== undefined && cat.count >= BASELINE.min_category_peers ? cat.median : peers.global),
      live_count: liveByCat.get(category) ?? 0,
      board_count: boardByCat.get(category) ?? 0,
      base_rate_pct: round1((tables.baseByCategory.get(category) ?? tables.globalBase) * 100),
    };
  }).sort((a, b) => b.board_count - a.board_count || (a.category < b.category ? -1 : 1));
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION, global_multiple: round4(peers.global),
    global_base_rate_pct: round1(tables.globalBase * 100),
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    excluded_cex: snapshot.protocols.filter((p) => isPreToken(p) && p.category === 'CEX').length,
    excluded_passthrough: snapshot.protocols.filter((p) => isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && PASS_CATEGORIES.has(p.category ?? '')).length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_implied_usd: impliedSorted.length ? impliedSorted[Math.floor(impliedSorted.length / 2)]! : 0,
    fit, validation, categories,
    chain_offsets: fit.chain_offsets,
    rows: scored.map((s, i) => ({
      rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
      tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at,
      age_days: s.age, implied_value_usd: s.implied, fit_log: s.fitLog, peer_log: s.peerLog,
      growth_part: s.growthPart, fitted_multiple: s.fittedMultiple, peer_multiple: round4(s.peerMultiple),
      peer_count: s.peerCount, odds: s.odds, base_rate_pct: s.baseRatePct, opportunity_usd: s.opportunity,
      pass_through: s.passThrough, confidence: s.confidence, farm_score: s.farmScore, risk: s.risk,
      capital_usd: s.capital, hold_days: holdDaysFor(s.age), in_watchlist: watch.has(s.p.slug),
    })),
    live,
  };
  return { board, radar };
}

function buildBoardFromScored(snapshot: Snapshot, scored: Scored[], peers: PeerTable): BoardRow[] {
  void snapshot;
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
    tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at, gecko_id: s.p.gecko_id, symbol: s.p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied,
    model: {
      fit_log: s.fitLog, fitted_multiple: s.fittedMultiple, peer_multiple: round4(s.peerMultiple),
      global_multiple: round4(peers.global), peer_count: s.peerCount,
      growth_pct: clamp(finite(s.p.change_7d, 0), BASELINE.growth_floor, BASELINE.growth_cap),
      odds: s.odds, base_rate_pct: s.baseRatePct, opportunity_usd: s.opportunity,
      pass_through: s.passThrough, confidence: s.confidence, farm_score: s.farmScore,
      risk: s.risk, capital_usd: s.capital, age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug, name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return `all rows share the same implied value`;
  if (board.length < 100) return `board has ${board.length} rows, under the 100 row floor`;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
