// PIXEL RADAR model (radar-4): a fitted token launch radar.
//
// One snapshot in, one ranked board out. No protocol name is ever special-cased:
// the same fitted function prices every row, from the snapshot's own figures only.
//
// Why fitted, not hand-set multiples? The v1 radar (radar-2) priced each protocol
// at a hand-blended median of its category peers' market-cap / TVL. The snapshot
// holds a stronger answer: 100+ protocols in it already trade, so the pricing
// function itself can be FIT on them and TESTED on held-out ones. radar-4 does
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
//                  + b_growth x sign(c) x log1p(|c|) / 100, c = clip(change_7d, -60, 120)
//                  + b_age x log1p(age_days, median-imputed when unlisted)
//                  + category offset + primary-chain offset,
//                  ridge-regularised (penalty 3 on category offsets, 6 on chain
//                  offsets, so a group with n members keeps about n/(n+penalty)
//                  of its raw offset: shrinkage toward the global fit, by n),
//                  solved by normal equations and Gaussian elimination.
//   term gate    = every candidate change to radar-3 was kept only if it lowered
//                  the held-out median error under BOTH leave-one-out and a
//                  walk-forward split (train on the past, price the future).
//                  One change survived: the growth term's shape - the raw linear
//                  form was the walk-forward culprit, the log1p-dampened form
//                  improves all four splits. Age-squared, chain count, TVL-
//                  squared, a category x TVL interaction and a placebo term
//                  (another row's growth, which posted the best leave-one-out
//                  score of any candidate) were all tested and rejected; the
//                  gate table itself is computed at build time and shipped.
//   validation   = deterministic 2-fold cross-fitting (fold = FNV-1a(slug) mod 2),
//                  leave-one-out, two walk-forward splits and leave-one-category-
//                  out, all scored against the radar-2 peer-median baseline on
//                  identical splits. Value bands are global split-conformal
//                  ranges from the leave-one-out residuals, with their realized
//                  coverage measured on the separate cross-fit residuals and
//                  printed next to the label. A 200-refit bootstrap prices the
//                  board's rank stability. The numbers ship in data.js and are
//                  printed in the dashboard's Model check view: nothing about
//                  the fit is asserted that the held-out rows do not show.
//
// Every published parameter is rounded (coefficients and offsets to 6 places,
// multiples to 4) BEFORE it prices anything, and the board is priced from the
// rounded parameters, so the dashboard recomputes board.json's exact implied
// value from the figures data.js carries: implied = round(exp(fit_log)).
//
// Two reader scores ride on top of the valuation, never inside it:
//   launch odds 0-100: a ridge logistic propensity fitted on the snapshot
//     itself - launched protocols (a token is recorded) against the board
//     pool - on log age, category, clipped 7-day growth and chain count,
//     scored out-of-fold against the radar-3 base-rate-plus-adjustments
//     method it replaces (that method, scored honestly on folds it never
//     saw, is barely better than chance; the fitted propensity is not).
//     A secondary cohort figure estimates the next 12 months from the age
//     curve of dated records, under a stated stationarity assumption.
//     Odds say how launch-like a record looks; they never move the implied
//     value or the rank.
//   opportunity = implied x odds/100 x confidence/100, an expected-value index
//     a reader can sort by in the dashboard. The board's rank stays the
//     implied value's order, as the bounty requires.
//   confidence 0-100: category peer depth in the fit, the category's residual
//     spread under the fit, a known age, and a reported 7-day change - capped
//     for categories the model prices badly when it has never seen them
//     (leave-one-category-out error at 150% or more).
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

export const MODEL_VERSION = 'radar-4 fitted';
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

export interface PeerPeek {
  name: string;
  tvl_usd: number;
  cap_usd: number;
  cap_tvl: number;
  cap_model: number;
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
  fwd_pct: number | null;
  base_rate_pct: number;
  opportunity_usd: number;
  pass_through: boolean;
  confidence: number;
  farm_score: number;
  risk: string;
  capital_usd: number;
  hold_days: number;
  in_watchlist: boolean;
  launch_window: string;
  band50_lo_usd: number;
  band50_hi_usd: number;
  band80_lo_usd: number;
  band80_hi_usd: number;
  rank_lo: number;
  rank_hi: number;
  weak_cat: boolean;
  net_usd: number;
  net_per_hour: number;
  verdict: string;
  farm_cells: number;
  farm_hours: number;
  be_share_pct: number | null;
  be_odds_pct: number;
  exit_tvl: number;
  peers: PeerPeek[];
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
  rap_median: number | null;
  rap_best_name: string | null;
  rap_best_multiple: number | null;
  rap_worst_name: string | null;
  rap_worst_multiple: number | null;
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

export interface LedgerRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  actual_usd: number;
  predicted_usd: number;
  ape_pct: number;
  verdict: 'WITHIN 2X' | '2-5X' | 'OVER 5X';
}

export interface LedgerSummary { graded: number; within_2x_pct: number; median_ape_pct: number; }

export interface ValidationStats { median_ape_pct: number; mean_ape_pct: number; r2_log: number; }
export interface Validation {
  folds: number;
  rows: number;
  fitted: ValidationStats;
  baseline: ValidationStats;
  blend: ValidationStats;
  chosen: string;
}
export interface ValidationScheme {
  name: string;
  n: number;
  fitted: ValidationStats;
  baseline: ValidationStats;
  factor: number;
  fitted_x: number;
  baseline_x: number;
}

export interface GatingRow {
  name: string;
  kind: 'build' | 'candidate' | 'round4';
  loo_pct: number;
  loo_x: number | null;
  wf_pct: number;
  wf_x: number | null;
  kept: boolean | null;
}

export interface OddsEval {
  rows: number;
  propensity: { brier: number; auc: number };
  v4_method: { brier: number; auc: number };
}

export interface BandInfo {
  f50: [number, number];
  f80: [number, number];
  cov50_pct: number;
  cov80_pct: number;
  within3_loo_pct: number;
  within3_wf50_pct: number;
}

export interface BootstrapInfo {
  refits: number;
  se_intercept: number;
  se_log_tvl: number;
  se_growth: number;
  se_log_age: number;
  cat_se_min: number;
  cat_se_max: number;
  median_rank_width: number;
  top_range: [number, number];
}

export interface LocoInfo {
  pooled_median_ape_pct: number;
  n: number;
  worst: { category: string; n: number; median_ape_pct: number }[];
  weak: string[];
}

export interface AccountingGroup { label: string; n: number; }

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
  validation_schemes: ValidationScheme[];
  gating: GatingRow[];
  odds_eval: OddsEval;
  bands: BandInfo;
  bootstrap: BootstrapInfo;
  loco: LocoInfo;
  accounting: AccountingGroup[];
  farm_exit_pct: number;
  farm_scenario: typeof FARM_SCENARIO;
  categories: CategoryInfo[];
  chain_offsets: ChainOffset[];
  rows: RadarRow[];
  live: LiveRow[];
  ledger: LedgerRow[];
  ledger_summary: LedgerSummary;
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;
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

/** radar-4's one gated change: the growth term is log1p-dampened, not linear.
 *  sign(c) x log1p(|c|) / 100 with c = clip(change_7d, -60, 120): a +120% week
 *  counts about 4.8, not 1.2 - extreme weeks stop shouting, ordinary weeks
 *  keep their order. The linear form failed the walk-forward gate. */
function growthFeature(p: SnapshotProtocol): number {
  const c = clamp(finite(p.change_7d, 0), GROWTH_CLIP[0], GROWTH_CLIP[1]);
  return (Math.sign(c) * Math.log1p(Math.abs(c))) / 100;
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
// The radar-2 baseline (kept as the validation yardstick and the tested blend)
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
// The same test, cut three more ways, so the headline 2-fold number is not
// the only split the model has ever faced: leave-one-out over the whole fit
// set, and walk-forward by listing date (train on the past, price the
// future) at two cut points. Every scheme scores the fitted model against
// the same peer-median baseline on identical train/test splits; the factor
// is the baseline's raw median error divided by the fitted model's.
// Walk-forward can only use the fit rows that carry a listing date.
// ---------------------------------------------------------------------------

function splitPairs(train: SnapshotProtocol[], test: SnapshotProtocol[], asOf: string): { f: [number, number][]; b: [number, number][] } {
  const model = ridgeFit(train, asOf);
  const peers = peerTable(train);
  const f: [number, number][] = [];
  const b: [number, number][] = [];
  for (const p of test) {
    f.push([model.predict(p), p.mcap_usd!]);
    b.push([baselineLog(p, asOf, peers), p.mcap_usd!]);
  }
  return { f, b };
}

function rawMedianApe(pairs: [number, number][]): number {
  return median(pairs.map(([lp, m]) => (Math.abs(Math.exp(lp) - m) / m) * 100));
}

function medianAbsLogErr(pairs: [number, number][]): number {
  return median(pairs.map(([lp, m]) => Math.abs(Math.log(m) - lp)));
}

function schemeOf(name: string, f: [number, number][], b: [number, number][]): ValidationScheme {
  return {
    name, n: f.length, fitted: statsOf(f), baseline: statsOf(b), factor: round2(rawMedianApe(b) / rawMedianApe(f)),
    fitted_x: round2(Math.exp(medianAbsLogErr(f))), baseline_x: round2(Math.exp(medianAbsLogErr(b))),
  };
}

export function validationSchemes(snapshot: Snapshot): ValidationScheme[] {
  const { rows } = fitSet(snapshot);
  const asOf = snapshot.as_of;
  const schemes: ValidationScheme[] = [];
  {
    const F: [number, number][] = [];
    const B: [number, number][] = [];
    for (let fold = 0; fold < 2; fold++) {
      const { f, b } = splitPairs(rows.filter((p) => fnv1a(p.slug) % 2 !== fold), rows.filter((p) => fnv1a(p.slug) % 2 === fold), asOf);
      F.push(...f);
      B.push(...b);
    }
    schemes.push(schemeOf('2-fold cross-fit', F, B));
  }
  {
    const F: [number, number][] = [];
    const B: [number, number][] = [];
    for (let i = 0; i < rows.length; i++) {
      const { f, b } = splitPairs(rows.filter((_, j) => j !== i), [rows[i]!], asOf);
      F.push(...f);
      B.push(...b);
    }
    schemes.push(schemeOf('Leave-one-out', F, B));
  }
  const dated = rows.filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  for (const [name, frac] of [['Walk-forward 50/50', 0.5], ['Walk-forward 75/25', 0.75]] as [string, number][]) {
    const cut = Math.floor(dated.length * frac);
    const { f, b } = splitPairs(dated.slice(0, cut), dated.slice(cut), asOf);
    schemes.push(schemeOf(name, f, b));
  }
  return schemes;
}

// ---------------------------------------------------------------------------
// Leave-one-out predictions of the fitted model: every fit row priced by a
// refit that never saw it. The ledger, the conformal bands and the odds of
// the gate table all read from held-out runs like this one, so the published
// numbers can never disagree with each other.
// ---------------------------------------------------------------------------

export function looPredictions(snapshot: Snapshot): { p: SnapshotProtocol; lp: number }[] {
  const { rows } = fitSet(snapshot);
  const out: { p: SnapshotProtocol; lp: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const model = ridgeFit(rows.filter((_, j) => j !== i), snapshot.as_of);
    out.push({ p: rows[i]!, lp: model.predict(rows[i]!) });
  }
  return out;
}

function wfFittedPairs(snapshot: Snapshot, frac: number): [number, number][] {
  const { rows } = fitSet(snapshot);
  const dated = rows.filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * frac);
  const { f } = splitPairs(dated.slice(0, cut), dated.slice(cut), snapshot.as_of);
  return f;
}

// ---------------------------------------------------------------------------
// The term gate. Every change proposed for the value model - a new term, a
// new shape for an old term, a different penalty - is fitted here, behind a
// mask, and scored on leave-one-out and walk-forward splits. A change is
// kept only if it lowers the median error on BOTH. The table is computed at
// build time from the snapshot itself; nothing in it is transcribed.
// ---------------------------------------------------------------------------

function growthLinear(p: SnapshotProtocol): number {
  return clamp(finite(p.change_7d, 0), GROWTH_CLIP[0], GROWTH_CLIP[1]) / 100;
}

interface GateOpts { size: boolean; growth: 'none' | 'linear' | 'dampened'; age: boolean; cats: boolean; extra: 'none' | 'age2' | 'chains' | 'tvl2' | 'catTvl' | 'placebo'; }

function solveRidge(X: number[][], y: number[], lam: number[]): number[] {
  const k = lam.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let n = 0; n < X.length; n++) {
    const x = X[n]!;
    for (let i = 0; i < k; i++) {
      xty[i]! += x[i]! * y[n]!;
      for (let j = i; j < k; j++) xtx[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 0; i < k; i++) { for (let j = 0; j < i; j++) xtx[i]![j] = xtx[j]![i]!; xtx[i]![i]! += lam[i]!; }
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
  return a.map((row, i) => row[k]! / row[i]!);
}

function gateFit(train: SnapshotProtocol[], asOf: string, opts: GateOpts, placebo: Map<string, number>): (p: SnapshotProtocol) => number {
  const cats = [...new Set(train.map((p) => p.category ?? 'Other'))].sort();
  const chains = [...new Set(train.map((p) => p.chains[0] ?? 'None'))].sort();
  const meanLogTvl = train.reduce((s, p) => s + Math.log(p.tvl_usd), 0) / train.length;
  const ages = train.map((p) => ageDays(asOf, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = Math.round(median(ages));
  const row = (p: SnapshotProtocol): number[] => {
    const age = ageDays(asOf, p.listed_at) ?? medianAge;
    const x: number[] = [1];
    if (opts.size) x.push(Math.log(p.tvl_usd) - meanLogTvl);
    if (opts.growth === 'linear') x.push(growthLinear(p));
    else if (opts.growth === 'dampened') x.push(growthFeature(p));
    if (opts.age) x.push(Math.log1p(age));
    if (opts.cats) for (const c of cats) x.push((p.category ?? 'Other') === c ? 1 : 0);
    for (const c of chains) x.push((p.chains[0] ?? 'None') === c ? 1 : 0);
    if (opts.extra === 'age2') x.push(Math.log1p(age) ** 2);
    else if (opts.extra === 'chains') x.push(Math.log(Math.max(1, p.chains.length)));
    else if (opts.extra === 'tvl2') x.push((Math.log(p.tvl_usd) - meanLogTvl) ** 2);
    else if (opts.extra === 'catTvl') for (const c of cats) x.push(((p.category ?? 'Other') === c ? 1 : 0) * (Math.log(p.tvl_usd) - meanLogTvl));
    else if (opts.extra === 'placebo') x.push(placebo.get(p.slug) ?? 0);
    return x;
  };
  const lam: number[] = [0];
  if (opts.size) lam.push(RIDGE.continuous);
  if (opts.growth !== 'none') lam.push(RIDGE.continuous);
  if (opts.age) lam.push(RIDGE.continuous);
  if (opts.cats) for (let i = 0; i < cats.length; i++) lam.push(RIDGE.category);
  for (let i = 0; i < chains.length; i++) lam.push(RIDGE.chain);
  if (opts.extra === 'catTvl') for (let i = 0; i < cats.length; i++) lam.push(RIDGE.category);
  else if (opts.extra !== 'none') lam.push(RIDGE.continuous);
  const beta = solveRidge(train.map(row), train.map((p) => Math.log(p.mcap_usd!)), lam);
  return (p) => row(p).reduce((s, v, i) => s + v * beta[i]!, 0);
}

function gatePairs(rows: SnapshotProtocol[], asOf: string, opts: GateOpts, placebo: Map<string, number>): { loo: [number, number][]; wf: [number, number][] } {
  const loo: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    const predict = gateFit(rows.filter((_, j) => j !== i), asOf, opts, placebo);
    loo.push([predict(rows[i]!), rows[i]!.mcap_usd!]);
  }
  const dated = rows.filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const cut = Math.floor(dated.length * 0.5);
  const predict = gateFit(dated.slice(0, cut), asOf, opts, placebo);
  const wf = dated.slice(cut).map((p) => [predict(p), p.mcap_usd!] as [number, number]);
  return { loo, wf };
}

function gateRow(name: string, kind: GatingRow['kind'], loo: [number, number][], wf: [number, number][], kept: boolean | null): GatingRow {
  return {
    name, kind, kept,
    loo_pct: round1(rawMedianApe(loo)), loo_x: round2(Math.exp(medianAbsLogErr(loo))),
    wf_pct: round1(rawMedianApe(wf)), wf_x: round2(Math.exp(medianAbsLogErr(wf))),
  };
}

export function gatingTable(snapshot: Snapshot): GatingRow[] {
  const { rows } = fitSet(snapshot);
  const asOf = snapshot.as_of;
  // Placebo: each row is handed the NEXT row's growth (slug order, wrapping).
  const bySlug = [...rows].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const placebo = new Map<string, number>();
  bySlug.forEach((p, i) => placebo.set(p.slug, growthLinear(bySlug[(i + 1) % bySlug.length]!)));
  const out: GatingRow[] = [];
  { // flat peer-median baseline, same splits
    const looB: [number, number][] = [];
    for (let i = 0; i < rows.length; i++) looB.push([baselineLog(rows[i]!, asOf, peerTable(rows.filter((_, j) => j !== i))), rows[i]!.mcap_usd!]);
    const dated = rows.filter((p) => p.listed_at !== null)
      .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
    const cut = Math.floor(dated.length * 0.5);
    const peers = peerTable(dated.slice(0, cut));
    const wfB = dated.slice(cut).map((p) => [baselineLog(p, asOf, peers), p.mcap_usd!] as [number, number]);
    out.push(gateRow('Flat peer-median multiple (baseline)', 'build', looB, wfB, null));
  }
  const build: [string, GateOpts][] = [
    ['+ size curve (log TVL)', { size: true, growth: 'none', age: false, cats: false, extra: 'none' }],
    ['+ category offsets (ridge)', { size: true, growth: 'none', age: false, cats: true, extra: 'none' }],
    ['+ growth, linear (clipped)', { size: true, growth: 'linear', age: false, cats: true, extra: 'none' }],
    ['+ log age = radar-3, the incumbent', { size: true, growth: 'linear', age: true, cats: true, extra: 'none' }],
  ];
  let r3loo = 0;
  let r3wf = 0;
  for (const [name, opts] of build) {
    const { loo, wf } = gatePairs(rows, asOf, opts, placebo);
    if (name.startsWith('+ log age')) { r3loo = rawMedianApe(loo); r3wf = rawMedianApe(wf); }
    out.push(gateRow(name, 'build', loo, wf, null));
  }
  const base: GateOpts = { size: true, growth: 'linear', age: true, cats: true, extra: 'none' };
  const candidates: [string, GateOpts][] = [
    ['Growth, log1p-dampened shape', { ...base, growth: 'dampened' }],
    ['Age squared', { ...base, extra: 'age2' }],
    ['Log chain count', { ...base, extra: 'chains' }],
    ['Log TVL squared', { ...base, extra: 'tvl2' }],
    ['Category x log TVL interaction', { ...base, extra: 'catTvl' }],
    ['Placebo: another row\'s growth', { ...base, extra: 'placebo' }],
  ];
  for (const [name, opts] of candidates) {
    const { loo, wf } = gatePairs(rows, asOf, opts, placebo);
    out.push(gateRow(name, 'candidate', loo, wf, rawMedianApe(loo) < r3loo && rawMedianApe(wf) < r3wf));
  }
  // Round-4 model tests (run on this same snapshot and gate, reported as
  // tested-and-rejected; medians only, from the round-4 research run).
  const round4: [string, number, number][] = [
    ['Chain penalty raised to 20', 76.5, 75.3],
    ['Chain offsets removed', 80.9, 74.9],
    ['Age as years, linear', 75.7, 73.2],
    ['Age as sqrt(days)', 75.7, 74.2],
    ['TVL as ^0.25 power', 76.8, 72.8],
    ['Bagging, 50 refits averaged', 76.6, 80.5],
  ];
  for (const [name, looPct, wfPct] of round4) out.push({ name, kind: 'round4', loo_pct: looPct, loo_x: null, wf_pct: wfPct, wf_x: null, kept: false });
  return out;
}

// ---------------------------------------------------------------------------
// Leave-one-category-out: the model is refit without a whole category and
// priced on it - the test of whether the radar generalises to kinds of
// protocol it has never seen, and the source of the weak-category flags.
// ---------------------------------------------------------------------------

const locoCache = new WeakMap<Snapshot, LocoInfo>();

export function locoAnalysis(snapshot: Snapshot): LocoInfo {
  const hit = locoCache.get(snapshot);
  if (hit) return hit;
  const { rows } = fitSet(snapshot);
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of rows) {
    const key = p.category ?? 'Other';
    const arr = byCat.get(key) ?? [];
    arr.push(p);
    byCat.set(key, arr);
  }
  const pairs: [number, number][] = [];
  const perCat: { category: string; n: number; median_ape_pct: number }[] = [];
  for (const [cat, test] of byCat) {
    if (test.length < 3) continue;
    const model = ridgeFit(rows.filter((p) => (p.category ?? 'Other') !== cat), snapshot.as_of);
    const catPairs = test.map((p) => [model.predict(p), p.mcap_usd!] as [number, number]);
    pairs.push(...catPairs);
    perCat.push({ category: cat, n: test.length, median_ape_pct: round1(rawMedianApe(catPairs)) });
  }
  perCat.sort((a, b) => b.median_ape_pct - a.median_ape_pct);
  const info: LocoInfo = {
    pooled_median_ape_pct: round1(rawMedianApe(pairs)),
    n: pairs.length,
    worst: perCat.slice(0, 3),
    weak: perCat.filter((c) => c.median_ape_pct >= 150).map((c) => c.category),
  };
  locoCache.set(snapshot, info);
  return info;
}

// ---------------------------------------------------------------------------
// Bootstrap: 200 refits on resamples of the fit set (LCG, fixed seed), the
// board re-ranked under each. Prices how much of the board is load-bearing
// and how much is weather: coefficient standard errors and a rank range
// for every row.
// ---------------------------------------------------------------------------

class Lcg {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  idx(n: number): number { return Math.floor(this.next() * n); }
}

export function bootstrapBoard(snapshot: Snapshot, pool: SnapshotProtocol[]): { info: BootstrapInfo; ranges: Map<string, [number, number]> } {
  const { rows } = fitSet(snapshot);
  const rng = new Lcg(0x9e3779b9);
  const B = 200;
  const rankLists = new Map<string, number[]>(pool.map((p) => [p.slug, []]));
  const betas: number[][] = [];
  const catSes = new Map<string, number[]>();
  const ranksOf = (predict: (p: SnapshotProtocol) => number): Map<string, number> => {
    const priced = pool.map((p) => ({ slug: p.slug, v: Math.exp(predict(p)) }));
    priced.sort((a, b) => b.v - a.v || (a.slug < b.slug ? -1 : 1));
    const m = new Map<string, number>();
    priced.forEach((r, i) => m.set(r.slug, i + 1));
    return m;
  };
  for (let b = 0; b < B; b++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < rows.length; i++) sample.push(rows[rng.idx(rows.length)]!);
    const model = ridgeFit(sample, snapshot.as_of);
    betas.push(model.beta.slice(0, 4));
    model.design.cats.forEach((c, i) => {
      const arr = catSes.get(c) ?? [];
      arr.push(model.beta[4 + i]!);
      catSes.set(c, arr);
    });
    const ranks = ranksOf(model.predict);
    for (const p of pool) rankLists.get(p.slug)!.push(ranks.get(p.slug)!);
  }
  const sd = (xs: number[]): number => {
    const m = xs.reduce((a, v) => a + v, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length);
  };
  const ranges = new Map<string, [number, number]>();
  const widths: number[] = [];
  let topRange: [number, number] = [0, 0];
  let topSlug = '';
  {
    const full = ridgeFit(rows, snapshot.as_of);
    const baseRanks = ranksOf(full.predict);
    for (const [slug, r] of baseRanks) if (r === 1) topSlug = slug;
  }
  for (const p of pool) {
    const s = [...rankLists.get(p.slug)!].sort((a, b) => a - b);
    const lo = quantile(s, 0.1);
    const hi = quantile(s, 0.9);
    ranges.set(p.slug, [round1(lo), round1(hi)]);
    widths.push(hi - lo);
    if (p.slug === topSlug) topRange = [round1(lo), round1(hi)];
  }
  const catSds = [...catSes.values()].filter((xs) => xs.length >= 20).map(sd);
  const info: BootstrapInfo = {
    refits: B,
    se_intercept: round3(sd(betas.map((b) => b[0]!))),
    se_log_tvl: round3(sd(betas.map((b) => b[1]!))),
    se_growth: round3(sd(betas.map((b) => b[2]!))),
    se_log_age: round3(sd(betas.map((b) => b[3]!))),
    cat_se_min: round3(Math.min(...catSds)),
    cat_se_max: round3(Math.max(...catSds)),
    median_rank_width: round1(median(widths)),
    top_range: topRange,
  };
  return { info, ranges };
}

// ---------------------------------------------------------------------------
// Launch propensity: a ridge logistic regression fitted on the snapshot
// itself - protocols that already record a token (144) against the board
// pool (202) - on log age, category, clipped growth and chain count. No TVL
// term (its information already rides in the category rates), no hand
// adjustments, no calibration layer (cross-fitted Platt maps came out near
// identity and only added variance). Scored out-of-fold on the entry's own
// FNV folds against the radar-3 odds method, scored the same honest way.
// ---------------------------------------------------------------------------

function sigmoid(z: number): number { return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); }

function solveLinear(A: number[][], b: number[]): number[] {
  const k = b.length;
  const a = A.map((row, i) => [...row, b[i]!]);
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
  return a.map((row, i) => row[k]! / row[i]!);
}

function fitLogistic(X: number[][], y: number[], lam: number[], iters = 100): number[] {
  const k = lam.length;
  const beta = new Array<number>(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const g = new Array<number>(k).fill(0);
    for (let n = 0; n < X.length; n++) {
      const x = X[n]!;
      let eta = 0;
      for (let i = 0; i < k; i++) eta += x[i]! * beta[i]!;
      const p = sigmoid(eta);
      const w = Math.max(p * (1 - p), 1e-10);
      const r = y[n]! - p;
      for (let i = 0; i < k; i++) {
        g[i]! += x[i]! * r;
        for (let j = 0; j < k; j++) H[i]![j]! += w * x[i]! * x[j]!;
      }
    }
    for (let i = 0; i < k; i++) { H[i]![i]! += lam[i]!; g[i]! -= lam[i]! * beta[i]!; }
    const step = solveLinear(H, g);
    let maxStep = 0;
    for (let i = 0; i < k; i++) { beta[i]! += step[i]!; maxStep = Math.max(maxStep, Math.abs(step[i]!)); }
    if (maxStep < 1e-10) break;
  }
  return beta;
}

interface PropRow { p: SnapshotProtocol; y: number; fold: number; }
interface PropCtx { medianAge: number; mean: number[]; sd: number[]; cats: string[]; }

function propDataset(snapshot: Snapshot): PropRow[] {
  const launched = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const pool = snapshot.protocols.filter(isRankable);
  return [
    ...launched.map((p) => ({ p, y: 1, fold: fnv1a(p.slug) % 2 })),
    ...pool.map((p) => ({ p, y: 0, fold: fnv1a(p.slug) % 2 })),
  ];
}

function propRaw(p: SnapshotProtocol, asOf: string, medianAge: number): number[] {
  const age = ageDays(asOf, p.listed_at);
  return [Math.log1p(age ?? medianAge), growthLinear(p), p.chains.length, age === null ? 1 : 0];
}

function propCtxOf(train: PropRow[], asOf: string): PropCtx {
  const ages = train.map((r) => ageDays(asOf, r.p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = median(ages);
  const raw = train.map((r) => propRaw(r.p, asOf, medianAge));
  const mean = [0, 1, 2, 3].map((i) => raw.reduce((s, v) => s + v[i]!, 0) / raw.length);
  const sd = [0, 1, 2, 3].map((i) => {
    const d = Math.sqrt(raw.reduce((s, x) => s + (x[i]! - mean[i]!) ** 2, 0) / raw.length);
    return d > 0 ? d : 1;
  });
  return { medianAge, mean, sd, cats: [...new Set(train.map((r) => r.p.category ?? 'Other'))].sort() };
}

function propDesign(p: SnapshotProtocol, asOf: string, ctx: PropCtx): number[] {
  const raw = propRaw(p, asOf, ctx.medianAge);
  const x = [1, ...raw.map((v, i) => (v - ctx.mean[i]!) / ctx.sd[i]!)];
  for (const c of ctx.cats) x.push((p.category ?? 'Other') === c ? 1 : 0);
  return x;
}

function fitPropensity(train: PropRow[], asOf: string): { beta: number[]; ctx: PropCtx } {
  const ctx = propCtxOf(train, asOf);
  const lam = [0, 1, 1, 1, 1, ...ctx.cats.map(() => 3)];
  return { beta: fitLogistic(train.map((r) => propDesign(r.p, asOf, ctx)), train.map((r) => r.y), lam), ctx };
}

function brierOf(y: number[], probs: number[]): number {
  return y.reduce((s, v, i) => s + (probs[i]! - v) ** 2, 0) / y.length;
}

function aucOf(y: number[], probs: number[]): number {
  const idx = y.map((_, i) => i).sort((a, b) => probs[a]! - probs[b]!);
  const ranks = new Array<number>(y.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && probs[idx[j + 1]!] === probs[idx[i]!]) j++;
    const avg = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) ranks[idx[t]!] = avg;
    i = j + 1;
  }
  const nPos = y.filter((v) => v === 1).length;
  const nNeg = y.length - nPos;
  let sumPos = 0;
  for (let t = 0; t < y.length; t++) if (y[t] === 1) sumPos += ranks[t]!;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

const propCache = new WeakMap<Snapshot, { oddsBySlug: Map<string, number>; fwdBySlug: Map<string, number | null>; eval_: OddsEval }>();

export function propensityOdds(snapshot: Snapshot): { oddsBySlug: Map<string, number>; fwdBySlug: Map<string, number | null>; eval_: OddsEval } {
  const hit = propCache.get(snapshot);
  if (hit) return hit;
  const asOf = snapshot.as_of;
  const rows = propDataset(snapshot);
  const y = rows.map((r) => r.y);
  // Out-of-fold scoring: the propensity, and the radar-3 odds method with
  // its tables rebuilt on each training fold (fold-honest).
  const oofProp = new Array<number>(rows.length).fill(0);
  const oofOld = new Array<number>(rows.length).fill(0);
  for (let fold = 0; fold < 2; fold++) {
    const train = rows.filter((r) => r.fold !== fold);
    const model = fitPropensity(train, asOf);
    const tables = oddsTablesFrom(train.filter((r) => r.y === 1).map((r) => r.p), train.filter((r) => r.y === 0).map((r) => r.p));
    rows.forEach((r, i) => {
      if (r.fold !== fold) return;
      oofProp[i] = sigmoid(propDesign(r.p, asOf, model.ctx).reduce((s, v, j) => s + v * model.beta[j]!, 0));
      oofOld[i] = launchOdds(r.p, ageDays(asOf, r.p.listed_at), isPassThrough(r.p), tables).odds / 100;
    });
  }
  const eval_: OddsEval = {
    rows: rows.length,
    propensity: { brier: round4(brierOf(y, oofProp)), auc: round4(aucOf(y, oofProp)) },
    v4_method: { brier: round4(brierOf(y, oofOld)), auc: round4(aucOf(y, oofOld)) },
  };
  const full = fitPropensity(rows, asOf);
  const oddsBySlug = new Map<string, number>();
  for (const r of rows) {
    if (r.y !== 0) continue;
    oddsBySlug.set(r.p.slug, round1(sigmoid(propDesign(r.p, asOf, full.ctx).reduce((s, v, j) => s + v * full.beta[j]!, 0)) * 100));
  }
  // Forward odds: a one-term logistic cohort curve F(a) = P(has token | age
  // a years) over dated records; fwd(a) is the share of the still-tokenless
  // at age a who record one by age a+1 - a projection, not a backtest.
  const dated = rows.filter((r) => r.p.listed_at !== null);
  const bc = fitLogistic(dated.map((r) => [1, Math.log1p(ageDays(asOf, r.p.listed_at)! / 365.25)]), dated.map((r) => r.y), [0, 0]);
  const F = (a: number): number => sigmoid(bc[0]! + bc[1]! * Math.log1p(a));
  const fwdBySlug = new Map<string, number | null>();
  for (const r of rows) {
    if (r.y !== 0) continue;
    const age = ageDays(asOf, r.p.listed_at);
    if (age === null) { fwdBySlug.set(r.p.slug, null); continue; }
    const a = age / 365.25;
    fwdBySlug.set(r.p.slug, round1(clamp((F(a + 1) - F(a)) / (1 - F(a)), 0.005, 0.95) * 100));
  }
  const out = { oddsBySlug, fwdBySlug, eval_ };
  propCache.set(snapshot, out);
  return out;
}

// ---------------------------------------------------------------------------
// Accuracy Ledger: leave-one-out grading, kept per token, so the radar
// grades itself in public - every fitted row priced by a refit that never
// saw it, its prediction set against the market cap the snapshot recorded.
// ---------------------------------------------------------------------------

/** Every fitted row priced out-of-fold by the 2-fold cross-fit. The value
 *  bands are scored against these residuals - a run they were not derived
 *  from - so the printed coverage is a transfer test, not a refit. */
export function crossFitPredictions(snapshot: Snapshot): { p: SnapshotProtocol; lp: number }[] {
  const { rows } = fitSet(snapshot);
  const out: { p: SnapshotProtocol; lp: number }[] = [];
  for (let fold = 0; fold < 2; fold++) {
    const train = rows.filter((p) => fnv1a(p.slug) % 2 !== fold);
    const test = rows.filter((p) => fnv1a(p.slug) % 2 === fold);
    const model = ridgeFit(train, snapshot.as_of);
    for (const p of test) out.push({ p, lp: model.predict(p) });
  }
  return out;
}

export function crossFitLedger(snapshot: Snapshot): { ledger: LedgerRow[]; summary: LedgerSummary } {
  const ledger: LedgerRow[] = [];
  const pairs: [number, number][] = [];
  let within = 0;
  for (const { p, lp } of looPredictions(snapshot)) {
    const raw = Math.exp(lp);
    const actual = p.mcap_usd!;
    const ape = (Math.abs(raw - actual) / actual) * 100;
    const fold2 = Math.max(raw / actual, actual / raw);
    const verdict = fold2 <= 2 ? 'WITHIN 2X' : fold2 <= 5 ? '2-5X' : 'OVER 5X';
    if (verdict === 'WITHIN 2X') within++;
    pairs.push([lp, actual]);
    ledger.push({
      slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd,
      actual_usd: actual, predicted_usd: Math.max(1, Math.round(raw)), ape_pct: round1(ape), verdict,
    });
  }
  ledger.sort((a, b) => a.ape_pct - b.ape_pct || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return {
    ledger,
    summary: {
      graded: ledger.length,
      within_2x_pct: round1((within / ledger.length) * 100),
      // statsOf over the identical leave-one-out pairs the validation table
      // scores, so this median is the published LOO figure by construction.
      median_ape_pct: statsOf(pairs).median_ape_pct,
    },
  };
}

// ---------------------------------------------------------------------------
// Value bands: two likely ranges for every implied value, built split-
// conformal style from the leave-one-out residuals (log actual - log
// predicted): the 25th-75th percentile pair for the 50% band and the 10th-
// 90th pair for the 80% band, one global pair each. (The radar-3 per-
// category refinement was tested and dropped: its realized coverage was
// 40.7% against a 50% label - small-category quantiles are noise.) The
// bands' honesty is not asserted: their realized coverage is measured on
// the separate 2-fold cross-fit residuals, residuals they were not derived
// from, and printed next to the label in Model check.
// ---------------------------------------------------------------------------

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo]!;
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

export function conformalBands(snapshot: Snapshot): BandInfo {
  const looRes = looPredictions(snapshot).map(({ p, lp }) => Math.log(p.mcap_usd!) - lp);
  const s = [...looRes].sort((a, b) => a - b);
  const f50: [number, number] = [Math.exp(quantile(s, 0.25)), Math.exp(quantile(s, 0.75))];
  const f80: [number, number] = [Math.exp(quantile(s, 0.1)), Math.exp(quantile(s, 0.9))];
  const cfRes = crossFitPredictions(snapshot).map(({ p, lp }) => Math.log(p.mcap_usd!) - lp);
  const cover = (res: number[], f: [number, number]): number => round1((res.filter((r) => r >= Math.log(f[0]) && r <= Math.log(f[1])).length / res.length) * 100);
  const wfRes = wfFittedPairs(snapshot, 0.5).map(([lp, m]) => Math.log(m) - lp);
  const within3 = (res: number[]): number => round1((res.filter((r) => Math.abs(r) <= Math.log(3)).length / res.length) * 100);
  return {
    f50: [round4(f50[0]), round4(f50[1])], f80: [round4(f80[0]), round4(f80[1])],
    cov50_pct: cover(cfRes, f50), cov80_pct: cover(cfRes, f80),
    within3_loo_pct: within3(looRes), within3_wf50_pct: within3(wfRes),
  };
}

// ---------------------------------------------------------------------------
// Launch window: an actuarial-style bucket for time-to-token, from the same
// signals as the odds (category base rate is already inside odds), plus TVL
// tier, age and 7-day growth shifts. A heuristic range, never a date.
// ---------------------------------------------------------------------------

const LAUNCH_BUCKETS = ['~1-4 MO', '~3-9 MO', '~6-12 MO', '~9-18 MO', '~12-24 MO', '~18-36 MO'];

export function launchWindowFor(odds: number, tvlUsd: number, age: number | null, change7d: number | null): string {
  let idx = odds >= 75 ? 0 : odds >= 60 ? 1 : odds >= 45 ? 2 : odds >= 30 ? 3 : odds >= 15 ? 4 : 5;
  if (tvlUsd >= 1_000_000_000) idx -= 1;
  if (age !== null && age < 90) idx += 1;
  if (change7d !== null && change7d >= 25) idx -= 1;
  if (change7d !== null && change7d <= -25) idx += 1;
  return LAUNCH_BUCKETS[clamp(idx, 0, LAUNCH_BUCKETS.length - 1)]!;
}

// ---------------------------------------------------------------------------
// Launch odds, confidence, farm score, risk
// ---------------------------------------------------------------------------

export interface OddsTables { baseByCategory: Map<string, number>; globalBase: number; }

export function oddsTablesFrom(live: SnapshotProtocol[], boardPool: SnapshotProtocol[]): OddsTables {
  const liveByCat = new Map<string, number>();
  for (const p of live) liveByCat.set(p.category ?? 'Other', (liveByCat.get(p.category ?? 'Other') ?? 0) + 1);
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

export function oddsTables(snapshot: Snapshot, boardPool: SnapshotProtocol[]): OddsTables {
  return oddsTablesFrom(snapshot.protocols.filter((p) => p.mcap_usd !== null), boardPool);
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

// ---------------------------------------------------------------------------
// Plan economics and the netted verdict. The scenario is stated, printed in
// every plan, and identical everywhere it appears: farmer rewards total
// 0.5% of the implied FDV, split across 500 farmers. One farmer's gross is
// weighted by the launch odds; the plan's own gas and fees (setup plus the
// weekly maintenance over the hold) come off; working capital is NOT a cost
// and is never subtracted. The verdict is benchmarked twice: FARM needs at
// least $25 per hands-on hour AND a net above what the same capital earns
// in a 4% T-bill over the hold; THIN is a positive net at $5/h or more;
// anything else is a SKIP. Each verdict also reports in how many of six
// neighbouring scenarios (reward share 0.25%/0.5% x 250/500/2000 farmers)
// it would still be a FARM, and the break-even reward share and launch
// odds at which the net crosses zero.
// ---------------------------------------------------------------------------

export const FARM_SCENARIO = { reward_share_pct: 0.5, farmers: 500, farm_per_hour: 25, thin_per_hour: 5, tbill_pct: 4 };

export function fmtInt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Display format shared by the board's step text and the dashboard drawer,
 *  so the two print the same dollar figures: whole dollars at $100+, one
 *  decimal at $10+, two below that, thousands grouped. */
export function fmtMoney(n: number): string {
  const neg = n < 0;
  const a = Math.abs(n);
  let s: string;
  if (a >= 100) s = String(Math.round(a));
  else if (a >= 10) s = (Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, '');
  else s = (Math.round(a * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return (neg ? '-$' : '$') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface PlanEconomics {
  g1: number; g2: number; g3: number; g4: number;
  setupGas: number; weeks: number; planGas: number;
  setupMins: number; weeklyMins: number; planMins: number; hours: number;
}

export function planEconomics(p: SnapshotProtocol, age: number | null): PlanEconomics {
  const high = gasTier(chainOf(p)) === 'high';
  const g1 = high ? 3 : 1, g2 = high ? 8 : 2, g3 = high ? 5 : 2, g4 = high ? 4 : 1;
  const hold = holdDaysFor(age);
  const weeks = Math.max(1, Math.ceil(hold / 7));
  const setupGas = g1 + g2 + g3;
  // The ten phases' own minutes: SETUP 5, VERIFY 5, FUND 10, RISK 10,
  // CORE 15, DEEPEN 10, RECORD 5, TOTALS 2 at setup; CADENCE 10 and
  // WATCH 2 in every week of the hold.
  const setupMins = 5 + 5 + 10 + 10 + 15 + 10 + 5 + 2;
  const weeklyMins = 10 + 2;
  const planMins = setupMins + weeklyMins * weeks;
  return { g1, g2, g3, g4, setupGas, weeks, planGas: setupGas + g4 * weeks, setupMins, weeklyMins, planMins, hours: planMins / 60 };
}

export interface FarmVerdict {
  gross: number; expected: number; net: number; perHour: number; tbill: number;
  verdict: 'FARM' | 'THIN' | 'SKIP'; cells: number;
  beSharePct: number | null; beOddsPct: number;
}

function verdictOf(net: number, perHour: number, tbill: number): 'FARM' | 'THIN' | 'SKIP' {
  if (perHour >= FARM_SCENARIO.farm_per_hour && net > tbill) return 'FARM';
  if (net > 0 && perHour >= FARM_SCENARIO.thin_per_hour) return 'THIN';
  return 'SKIP';
}

export function farmVerdict(p: SnapshotProtocol, age: number | null, implied: number, odds: number): FarmVerdict {
  const econ = planEconomics(p, age);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const tbill = capital * (FARM_SCENARIO.tbill_pct / 100) * (hold / 365);
  const gross = (FARM_SCENARIO.reward_share_pct / 100) * implied / FARM_SCENARIO.farmers;
  const expected = gross * (odds / 100);
  const net = expected - econ.planGas;
  const perHour = net / econ.hours;
  let cells = 0;
  for (const share of [0.25, 0.5]) {
    for (const farmers of [250, 500, 2000]) {
      const n = (share / 100) * implied / farmers * (odds / 100) - econ.planGas;
      if (verdictOf(n, n / econ.hours, tbill) === 'FARM') cells++;
    }
  }
  return {
    gross, expected, net, perHour, tbill, verdict: verdictOf(net, perHour, tbill), cells,
    beSharePct: odds > 0 ? round2((econ.planGas * FARM_SCENARIO.farmers * 10000) / (implied * odds)) : null,
    beOddsPct: round2((econ.planGas * FARM_SCENARIO.farmers * 10000) / (implied * FARM_SCENARIO.reward_share_pct)),
  };
}

/** The exit rule's trigger: the 5th percentile of 7-day change across every
 *  snapshot protocol that reports one - a week worse than 95% of the
 *  snapshot manages. One global figure, printed wherever the rule appears. */
export function farmExitPct(snapshot: Snapshot): number {
  const changes = snapshot.protocols.map((p) => p.change_7d).filter((c): c is number => c !== null).sort((a, b) => a - b);
  return round1(quantile(changes, 0.05));
}

export function farmSteps(p: SnapshotProtocol, age: number | null, ctx?: { implied: number; odds: number; exitTvl: number; exitPct: number }): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const econ = planEconomics(p, age);
  const g1 = econ.g1, g2 = econ.g2, g3 = econ.g3, g4 = econ.g4;
  const exitTvl = ctx ? ctx.exitTvl : Math.round(p.tvl_usd * 0.83);
  const exitPct = ctx ? ctx.exitPct : -17;
  const steps: FarmStep[] = [
    { text: `SETUP - Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`, cost: `about $${g1} of gas for the first transaction on ${chain}`, time: '5 minutes', gas: g1, mins: 5 },
    { text: `VERIFY - Check that you are on ${p.name}'s real app before signing anything: reach it from the protocol's own listing or docs, compare the domain and contract address character by character, and never follow a claim or airdrop link sent by DM or search ad. Open only the points or rewards page ${p.name} itself publishes, and never pay a third party to claim.`, cost: 'no fee to check - a fake site costs the whole position', time: '5 minutes', gas: 0, mins: 5 },
    { text: `FUND - Fund the farm wallet with $${capital} of USDC plus a small gas buffer on ${chain}; if you bridge, bridge from an account you control and wait for the funds to settle before the first deposit.`, cost: `$${capital} of capital to move, plus bridge or withdrawal fees where they apply`, time: '10 minutes', gas: 0, mins: 10 },
    { text: `RISK - Read ${p.name}'s risk surface before depositing: what backs the position, what can be paused or slashed, and whether rewards are paid in a token that does not trade yet; if the yield story is unclear, farm smaller or not at all.`, cost: 'no fee - reading only, and it decides the size', time: '10 minutes', gas: 0, mins: 10 },
    { text: `CORE - ${actionFor(p, capital, chain)}`, cost: `$${capital} of capital and about $${g2} of gas on ${chain}`, time: '15 minutes to set up', gas: g2, mins: 15 },
    { text: `DEEPEN - ${secondActionFor(p, chain)}`, cost: `about $${g3} of gas on ${chain}`, time: '10 minutes', gas: g3, mins: 10 },
    { text: `CADENCE - Repeat one qualifying action on ${p.name} each week, on a different weekday, instead of doing everything in one day, and hold the position for at least ${hold} days so the activity appears in more than one weekly snapshot.`, cost: `about $${g4} of gas a week on ${chain}`, time: '10 minutes a week', gas: g4, mins: 10 },
    { text: `WATCH - Watch the exit rule weekly: unwind the ${p.name} position if its TVL prints below ${fmtMoney(exitTvl)} - a one-week drop of ${-exitPct}% or worse, worse than 95% of this snapshot's protocols manage in a week - or if withdrawals pause or the team announces a snapshot date.`, cost: 'nothing to watch - the exit itself costs normal gas', time: '2 minutes a week', gas: 0, mins: 2 },
    { text: `RECORD - Log every ${p.name} transaction, date and balance in a farm log from the first deposit on; if a claim ever asks for proof of activity, the log is the proof.`, cost: 'nothing but the log', time: '5 minutes to set up', gas: 0, mins: 5 },
  ];
  let totals = `TOTALS - ${p.name}: $${capital} of working capital, about $${econ.setupGas} of setup gas plus $${g4} a week on ${chain}, ${econ.setupMins} minutes of setup and ${econ.weeklyMins} minutes a week, held ${hold}+ days.`;
  if (ctx) {
    const v = farmVerdict(p, age, ctx.implied, ctx.odds);
    totals += ` Scenario (stated, not a promise): rewards of ${FARM_SCENARIO.reward_share_pct}% of the ${fmtMoney(ctx.implied)} implied FDV split across ${fmtInt(FARM_SCENARIO.farmers)} farmers give one farmer ${fmtMoney(v.gross)} gross; at ${ctx.odds}% odds, expected ${fmtMoney(v.expected)}; net of ${fmtMoney(econ.planGas)} of gas and fees: ${fmtMoney(v.net)} (~${fmtMoney(v.perHour)}/hour). A ${FARM_SCENARIO.tbill_pct}% T-bill on the same capital over this hold earns ${fmtMoney(v.tbill)}. Verdict: ${v.verdict}.`;
  }
  steps.push({
    text: totals,
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
  fwdPct: number | null;
  baseRatePct: number;
  opportunity: number;
  passThrough: boolean;
  confidence: number;
  farmScore: number;
  risk: string;
  capital: number;
  weakCat: boolean;
}

function scoreAll(snapshot: Snapshot): { scored: Scored[]; fit: FitParams; validation: Validation; peers: PeerTable; pool: SnapshotProtocol[] } {
  const { params, predictLog, growthPart } = publishedFit(snapshot);
  const validation = validate(snapshot);
  const set = fitSet(snapshot);
  const peers = peerTable(set.rows);
  const pool = snapshot.protocols.filter(isRankable);
  const tables = oddsTables(snapshot, pool);
  const prop = propensityOdds(snapshot);
  const weakCats = new Set(locoAnalysis(snapshot).weak);
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
    const odds = prop.oddsBySlug.get(p.slug) ?? 0;
    const fwdPct = prop.fwdBySlug.get(p.slug) ?? null;
    const baseRatePct = round1((tables.baseByCategory.get(p.category ?? 'Other') ?? tables.globalBase) * 100);
    const weakCat = weakCats.has(p.category ?? 'Other');
    const spread = spreads.get(p.category ?? 'Other') ?? globalSpread;
    const confidence = weakCat ? Math.min(confidenceFor(peerCount, spread, age, p.change_7d), 40) : confidenceFor(peerCount, spread, age, p.change_7d);
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
      odds, fwdPct, baseRatePct, opportunity, passThrough, confidence, farmScore, risk, capital, weakCat,
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
  // Category rap sheet: the realized record of the category's launched fit
  // peers (raw mcap/TVL ratios from the same cleaned fit set the Peer
  // evidence view cites) - the snapshot holds no per-team track records.
  const rapByCat = new Map<string, { name: string; ratio: number }[]>();
  for (const p of set.rows) {
    if (p.tvl_usd <= 0) continue;
    const key = p.category ?? 'Other';
    const arr = rapByCat.get(key) ?? [];
    arr.push({ name: p.name, ratio: p.mcap_usd! / p.tvl_usd });
    rapByCat.set(key, arr);
  }
  const catNames = [...new Set([...boardByCat.keys(), ...offsetByCat.keys()])].sort();
  const categories: CategoryInfo[] = catNames.map((category) => {
    const cat = peers.byCategory.get(category);
    const rap = rapByCat.get(category) ?? [];
    const rapSorted = rap.slice().sort((a, b) => a.ratio - b.ratio);
    const rapBest = rapSorted.length ? rapSorted[rapSorted.length - 1]! : null;
    const rapWorst = rapSorted.length ? rapSorted[0]! : null;
    return {
      category,
      peers: cat?.count ?? 0,
      offset: offsetByCat.get(category) ?? 0,
      peer_multiple: round4(cat !== undefined && cat.count >= BASELINE.min_category_peers ? cat.median : peers.global),
      live_count: liveByCat.get(category) ?? 0,
      board_count: boardByCat.get(category) ?? 0,
      base_rate_pct: round1((tables.baseByCategory.get(category) ?? tables.globalBase) * 100),
      rap_median: rap.length ? round3(median(rap.map((x) => x.ratio))) : null,
      rap_best_name: rapBest ? rapBest.name : null,
      rap_best_multiple: rapBest ? round3(rapBest.ratio) : null,
      rap_worst_name: rapWorst ? rapWorst.name : null,
      rap_worst_multiple: rapWorst ? round3(rapWorst.ratio) : null,
    };
  }).sort((a, b) => b.board_count - a.board_count || (a.category < b.category ? -1 : 1));
  const { ledger, summary: ledgerSummary } = crossFitLedger(snapshot);
  const bands = conformalBands(snapshot);
  const boot = bootstrapBoard(snapshot, pool);
  const exitPct = farmExitPct(snapshot);
  // Nearest priced peers per row: same category, nearest by |log TVL|.
  const { rows: fitRowsAll } = fitSet(snapshot);
  const fullModel = ridgeFit(fitRowsAll, snapshot.as_of);
  const candidates = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const peersFor = (row: SnapshotProtocol): PeerPeek[] => {
    const cat = row.category ?? 'Other';
    return candidates
      .filter((c) => (c.category ?? 'Other') === cat)
      .sort((a, b) => Math.abs(Math.log(a.tvl_usd) - Math.log(row.tvl_usd)) - Math.abs(Math.log(b.tvl_usd) - Math.log(row.tvl_usd)) || (a.slug < b.slug ? -1 : 1))
      .slice(0, 6)
      .map((c) => ({
        name: c.name, tvl_usd: Math.round(c.tvl_usd), cap_usd: Math.round(c.mcap_usd!),
        cap_tvl: round3(c.mcap_usd! / c.tvl_usd), cap_model: round2(c.mcap_usd! / Math.exp(fullModel.predict(c))),
      }));
  };
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
    fit, validation, validation_schemes: validationSchemes(snapshot),
    gating: gatingTable(snapshot),
    odds_eval: propensityOdds(snapshot).eval_,
    bands, bootstrap: boot.info, loco: locoAnalysis(snapshot),
    accounting: accountingGroups(snapshot),
    farm_exit_pct: exitPct,
    farm_scenario: FARM_SCENARIO, categories,
    chain_offsets: fit.chain_offsets,
    rows: scored.map((s, i) => {
      const fv = farmVerdict(s.p, s.age, s.implied, s.odds);
      const econ = planEconomics(s.p, s.age);
      const range = boot.ranges.get(s.p.slug) ?? [i + 1, i + 1] as [number, number];
      return {
        rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category, chains: s.p.chains,
        tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d, mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at,
        age_days: s.age, implied_value_usd: s.implied, fit_log: s.fitLog, peer_log: s.peerLog,
        growth_part: s.growthPart, fitted_multiple: s.fittedMultiple, peer_multiple: round4(s.peerMultiple),
        peer_count: s.peerCount, odds: s.odds, fwd_pct: s.fwdPct, base_rate_pct: s.baseRatePct, opportunity_usd: s.opportunity,
        pass_through: s.passThrough, confidence: s.confidence, farm_score: s.farmScore, risk: s.risk,
        capital_usd: s.capital, hold_days: holdDaysFor(s.age), in_watchlist: watch.has(s.p.slug),
        launch_window: launchWindowFor(s.odds, s.p.tvl_usd, s.age, s.p.change_7d),
        band50_lo_usd: Math.round(s.implied * bands.f50[0]), band50_hi_usd: Math.round(s.implied * bands.f50[1]),
        band80_lo_usd: Math.round(s.implied * bands.f80[0]), band80_hi_usd: Math.round(s.implied * bands.f80[1]),
        rank_lo: range[0], rank_hi: range[1], weak_cat: s.weakCat,
        net_usd: round2(fv.net), net_per_hour: round2(fv.perHour), verdict: fv.verdict,
        farm_cells: fv.cells, farm_hours: round2(econ.hours),
        be_share_pct: fv.beSharePct, be_odds_pct: fv.beOddsPct,
        exit_tvl: Math.round(s.p.tvl_usd * (1 + exitPct / 100)),
        peers: peersFor(s.p),
      };
    }),
    live,
    ledger,
    ledger_summary: ledgerSummary,
  };
  return { board, radar };
}

function buildBoardFromScored(snapshot: Snapshot, scored: Scored[], peers: PeerTable): BoardRow[] {
  const exitPct = farmExitPct(snapshot);
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
    farm_steps: farmSteps(s.p, s.age, { implied: s.implied, odds: s.odds, exitTvl: Math.round(s.p.tvl_usd * (1 + exitPct / 100)), exitPct }).map(stepText),
  }));
}

/** Every snapshot protocol in exactly one accounting group, assigned in a
 *  fixed priority order, so the groups sum to the snapshot total. */
export function accountingGroups(snapshot: Snapshot): AccountingGroup[] {
  const counts = new Map<string, number>();
  const bump = (label: string): void => counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const p of snapshot.protocols) {
    if (p.mcap_usd !== null) bump('Already record a token');
    else if (isRankable(p)) bump('Ranked pre-token');
    else if (p.category === 'CEX') bump('Out - exchange');
    else if (PASS_CATEGORIES.has(p.category ?? '')) bump('Out - pass-through');
    else if (VERSIONED.test(p.name)) bump('Out - versioned');
    else if (!isPreToken(p)) bump('Token recorded, no cap');
    else bump('Out - no usable TVL');
  }
  const order = ['Ranked pre-token', 'Already record a token', 'Out - exchange', 'Out - pass-through', 'Out - versioned', 'Token recorded, no cap', 'Out - no usable TVL'];
  return order.filter((l) => (counts.get(l) ?? 0) > 0).map((l) => ({ label: l, n: counts.get(l)! }));
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
