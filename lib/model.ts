// PIXEL RADAR model (radar-2): a comparables token launch radar.
//
// One snapshot in, one ranked board out. No protocol name is ever special-cased:
// the same function scores every row, from the snapshot's own figures only.
//
// Why comparables, not one flat multiple? A flat TVL multiple pretends a lending
// market and a DEX are worth the same per dollar locked. The snapshot itself
// contains the market's answer: 100+ protocols in it already trade, so for each
// category we can read what the market actually pays per dollar of TVL.
//
//   peerRatio(p)   = mcap_usd / tvl_usd for a live-token protocol, winsorised
//   peerMultiple   = median peerRatio in the protocol's own category
//                    (needs 3+ live peers, else the global median is used)
//   globalMultiple = median peerRatio across every live protocol
//   effective      = clamp(0.65 x peerMultiple + 0.35 x globalMultiple, 0.06, 1.00)
//   growthMult     = 1 + clamp(change_7d, -60, 120) / 100 x 0.50
//   maturityMult   = 0.60 + min(age_days, 1095) / 1095 x 0.40  (unknown age: 365d)
//   chainMult      = 1 + min(chains - 1, 4) x 0.025  (multi-chain reach, capped +10%)
//   implied        = max(1, round(tvl x effective x growthMult x maturityMult x chainMult))
//
// Two reader scores ride on top of the valuation, never inside it:
//   confidence 0-100: peer depth, a known age, and a reported 7d change.
//   farm score 0-100: value size, momentum, confidence and capital efficiency,
//                     so a reader can sort by "worth my time", not just size.

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

export interface ModelConstants {
  peer_weight: number;
  global_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  ratio_floor: number;
  ratio_cap: number;
  min_category_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  peer_weight: 0.65,
  global_weight: 0.35,
  multiple_floor: 0.06,
  multiple_cap: 1.0,
  ratio_floor: 0.02,
  ratio_cap: 2.5,
  min_category_peers: 3,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_max_extra: 4,
};

export const MODEL_VERSION = 'radar-2 comparables';
export const EARLY_ROWS = 200;
export const LIVE_ROWS = 36;

export interface FarmStep { text: string; cost: string; time: string; }

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
    peer_multiple: number;
    global_multiple: number;
    effective_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
    confidence: number;
    farm_score: number;
    risk: string;
    capital_usd: number;
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
  peer_multiple: number;
  effective_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
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

export interface CategoryPeer { category: string; peers: number; median_multiple: number; }

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_implied_usd: number;
  categories: CategoryPeer[];
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError'; }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
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

/** Live-token peers: the market evidence the comparables model reads. */
export interface PeerTable { global: number; byCategory: Map<string, { median: number; count: number }>; list: CategoryPeer[]; }

export function peerTable(snapshot: Snapshot, model: ModelConstants = MODEL): PeerTable {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX' && p.tvl_usd > 0 && p.mcap_usd !== null);
  const ratio = (p: SnapshotProtocol): number => clamp(p.mcap_usd! / p.tvl_usd, model.ratio_floor, model.ratio_cap);
  const global = median(live.map(ratio));
  const groups = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const arr = groups.get(key) ?? [];
    arr.push(ratio(p));
    groups.set(key, arr);
  }
  const byCategory = new Map<string, { median: number; count: number }>();
  const list: CategoryPeer[] = [];
  for (const [category, arr] of groups) {
    byCategory.set(category, { median: median(arr), count: arr.length });
    list.push({ category, peers: arr.length, median_multiple: round4(median(arr)) });
  }
  list.sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  return { global, byCategory, list };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

export interface Scored {
  implied: number; peerMultiple: number; effectiveMultiple: number; peerCount: number;
  growthPct: number; growthMult: number; maturityMult: number; chainMult: number;
  age: number | null; confidence: number; farmScore: number; risk: string; capital: number;
}

export function scoreProtocol(p: SnapshotProtocol, asOf: string, peers: PeerTable, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const cat = peers.byCategory.get(p.category ?? 'Other');
  const useCategory = cat !== undefined && cat.count >= model.min_category_peers;
  const peerMultiple = useCategory ? cat.median : peers.global;
  const peerCount = useCategory ? cat.count : 0;
  // Every multiplier is rounded to 4 places before it is used, so the dashboard
  // recomputes the board's exact implied value from the figures data.js carries.
  const effective = round4(clamp(model.peer_weight * peerMultiple + model.global_weight * peers.global, model.multiple_floor, model.multiple_cap));
  const growthPct = clamp(finite(p.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = round4(1 + (growthPct / 100) * model.growth_weight);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = round4(model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range);
  const chainMult = round4(1 + Math.min(Math.max(p.chains.length - 1, 0), model.chain_max_extra) * model.chain_step);
  const implied = Math.max(1, Math.round(p.tvl_usd * effective * growthMult * maturityMult * chainMult));
  let confidence = 40;
  confidence += peerCount >= 5 ? 25 : peerCount >= 3 ? 18 : peerCount >= 1 ? 8 : 0;
  if (age !== null) confidence += 15 + Math.round((Math.min(age, model.maturity_days) / model.maturity_days) * 10);
  if (p.change_7d !== null) confidence += 10;
  confidence = Math.min(98, confidence);
  const capital = capitalFor(p);
  const sizePart = clamp((Math.log10(Math.max(implied, 1)) - 6) / 3, 0, 1) * 35;
  const momentumPart = clamp((growthPct + 20) / 80, 0, 1) * 20;
  const efficiencyPart = clamp((Math.log10(Math.max(implied / capital, 1)) - 3) / 4, 0, 1) * 20;
  const farmScore = Math.round(clamp(sizePart + momentumPart + efficiencyPart + confidence * 0.25, 0, 100));
  let risk = age !== null && age >= 365 && p.tvl_usd >= 100_000_000 ? 'Lower' : age !== null && age >= 180 && p.tvl_usd >= 20_000_000 ? 'Medium' : 'High';
  if (risk === 'Lower' && growthPct <= -20) risk = 'Medium';
  else if (risk === 'Medium' && growthPct <= -30) risk = 'High';
  return { implied, peerMultiple, effectiveMultiple: effective, peerCount, growthPct, growthMult, maturityMult, chainMult, age, confidence, farmScore, risk, capital };
}

/** Backwards-compatible single-protocol valuation used by tests and the page check. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, peers: PeerTable): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const s = scoreProtocol(protocol, asOf, peers, model);
  return { implied: s.implied, growthPct: s.growthPct, growthMult: s.growthMult, maturityMult: s.maturityMult, age: s.age };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const peers = peerTable(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, peers, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd,
    listed_at: p.listed_at, gecko_id: p.gecko_id, symbol: p.symbol,
    token_status: 'pre-token', age_days: s.age, implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple), global_multiple: round4(peers.global),
      effective_multiple: round4(s.effectiveMultiple), peer_count: s.peerCount,
      growth_pct: s.growthPct, growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult), chain_multiplier: round4(s.chainMult),
      age_days: s.age, confidence: s.confidence, farm_score: s.farmScore, risk: s.risk, capital_usd: s.capital,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string { return p.chains.length > 0 ? p.chains[0]! : 'its main chain'; }

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
  const chain = chainOf(p); const capital = capitalFor(p); const hold = holdDaysFor(age);
  return [
    { text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
    { text: secondActionFor(p, chain), cost: 'about $2 to $5 of gas', time: '10 minutes' },
    { text: `Repeat one qualifying action on ${p.name} each week, on a different weekday, instead of doing everything in one day.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the ${p.name} position for at least ${hold} days so the activity appears in more than one weekly snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Open only the points or rewards page that ${p.name} itself publishes, check eligibility there, and never pay a third party to claim.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Log every ${p.name} transaction, date and balance in a farm log, set a stop rule for a TVL drop over 30%, and unwind if it triggers.`, cost: 'nothing but the log', time: '5 minutes to set up, 2 minutes a week' },
  ];
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

export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank, slug: row.slug, name: row.name, category: row.category, chains: row.chains,
    tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: row.mcap_usd, listed_at: row.listed_at,
    age_days: row.age_days, implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple, effective_multiple: row.model.effective_multiple,
    peer_count: row.model.peer_count, growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier, chain_multiplier: row.model.chain_multiplier,
    confidence: row.model.confidence, farm_score: row.model.farm_score, risk: row.model.risk,
    capital_usd: row.model.capital_usd, hold_days: holdDaysFor(row.age_days), in_watchlist: watchlist.has(row.slug),
  };
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerTable(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION, global_multiple: round4(peers.global),
    watchlist_size: snapshot.watchlist.length, board_size: board.length, early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    median_implied_usd: impliedSorted.length ? impliedSorted[Math.floor(impliedSorted.length / 2)]! : 0,
    categories: peers.list.slice(0, 14),
    rows: board.map((r) => radarRow(r, watch)),
    live,
  };
  return { board, radar };
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
