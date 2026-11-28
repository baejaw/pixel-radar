// PIXEL RADAR dashboard (radar-4): renders window.RADAR (data.js, written by
// main.ts). No network: every byte shown is in data.js.
(function () {
'use strict';
var DATA = window.RADAR;
if (!DATA) return;
var app = document.getElementById('board');
var state = { q: '', category: 'all', chain: 'all', tier: 'all', risk: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, starredOnly: false, preset: 'all', lerr: 1, portBudget: 10000, portHours: 5 };
var stars = new Set(); var done = {};

var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
function fmtUsd(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K'; return usd.format(n); }
function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
function fmtAge(d) { if (d === null || d === undefined) return '?'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
// impliedOf recomputes the board's number from the published fit_log.
function impliedOf(r) { return Math.max(1, Math.round(Math.exp(r.fit_log))); }
function el(tag, attrs) {
  var n = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
  if (k === 'class') n.className = attrs[k]; else if (k === 'text') n.textContent = attrs[k];
  else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
  else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
  });
  for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c === null || c === undefined) continue; if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); }); else if (typeof c === 'string') n.appendChild(document.createTextNode(c)); else n.appendChild(c); }
  return n;
}
function seg(score, white) { var s = el('span', { class: 'seg', 'aria-hidden': 'true' }); var filled = Math.round(score / 20); for (var i = 0; i < 5; i++) s.appendChild(el('i', { class: i < filled ? (white && i < 2 ? 'fw' : 'f') : '' })); return s; }
// Purple bars are the data language; grey is the baseline or a down move.
function vbar(pct, grey, w) { var b = el('span', { class: 'vbar' + (grey ? ' grey' : ''), 'aria-hidden': 'true' }); if (w) b.style.width = w + 'px'; var fill = el('i', { style: 'width:' + clamp(Math.round(pct), 0, 100) + '%' }); if (!grey) fill.style.backgroundSize = (w || 56) + 'px 100%'; b.appendChild(fill); return b; }
function fixGradients() { var fills = document.querySelectorAll('.bar.block i, .progress i'); for (var i = 0; i < fills.length; i++) { var p = fills[i].parentElement; if (p && p.clientWidth) fills[i].style.backgroundSize = p.clientWidth + 'px 100%'; } }
var WATCH_LO = 35e6;
function inWatch(r) { return r.tvl_usd >= WATCH_LO && r.tvl_usd < DATA.floor_usd; }
function floorPct(r) { return Math.round(r.tvl_usd / DATA.floor_usd * 100); }
function pbar(pct, grey) { var b = el('span', { class: 'bar block' + (grey ? ' grey' : ''), 'aria-hidden': 'true' }); b.appendChild(el('i', { style: 'width:' + clamp(Math.round(pct), 0, 100) + '%' })); return b; }

// Farm plan: the same derivation lib/model.ts writes into board.json.
function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; if (p.tvl_usd >= 2e7) return 75; return 50; }
function holdFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
function fillTpl(t, p, cap, chain) { return t.split('#C#').join(cap).split('#N#').join(p.name).split('#H#').join(chain); }
function pickTpl(table, p, cap, chain) {
  var c = (p.category || '').toLowerCase();
  for (var i = 0; i < table.length; i++) { var ks = table[i][0]; for (var j = 0; j < ks.length; j++) if (c.indexOf(ks[j]) >= 0) return fillTpl(table[i][1], p, cap, chain); }
  return fillTpl(table[table.length - 1][1], p, cap, chain);
}
var ACTIONS = [
  [['lend', 'cdp', 'collateral'], 'Supply $#C# of USDC to #N# on #H# and keep the supplied position open.'],
  [['dex', 'yield', 'leveraged farm'], "Provide $#C# of two-sided liquidity to #N#'s main pool on #H# and keep the LP position open."],
  [['bridge'], 'Bridge $#C# of USDC to #H# through #N#, then use the bridged funds once inside its app.'],
  [['staking', 'restak'], "Stake $#C# of the chain's staking asset through #N# on #H# and keep the staking receipt."],
  [['perpetual', 'derivative'], 'Deposit $#C# of USDC as margin on #N# and open one small hedged trade, then close it cleanly.'],
  [['prediction'], 'Fund $#C# on #N# and place one small position in an active market you understand.'],
  [['curator', 'allocator'], 'Deposit $#C# into one diversified #N# vault on #H# and keep the vault shares.'],
  [['stable'], 'Mint or deposit $#C# of the stable asset through #N# on #H# and hold the minted asset.'],
  [['rwa'], "Mint $#C# of the protocol's yield asset on #H# through #N# and hold it in the same wallet."],
  [['insurance'], 'Buy $#C# of cover from #N# on #H# for a position you actually hold and keep the policy.'],
  [[], 'Deposit $#C# of USDC into #N# on #H# and keep the position open in that wallet.']
];
function actionFor(p, cap, chain) { return pickTpl(ACTIONS, p, cap, chain); }
var SECONDS = [
  [['lend', 'cdp'], 'Borrow a small amount against the supply on #N#, repay it in full, and repeat once so both sides of the market are used.'],
  [['dex'], 'Make two small swaps through #N# on #H# on different days, keeping each swap under 10% of your position.'],
  [['bridge'], 'Bridge a second, smaller amount back through #N# a week later so the route is used in both directions.'],
  [['staking', 'restak'], 'Claim any staking rewards on #N# once and restake or hold them; do not sell the receipt token.'],
  [['perpetual', 'derivative'], 'Place one limit order and one market order on #N# in separate weeks so the activity is not a single burst.'],
  [['curator', 'allocator', 'yield'], 'Move a small part of the deposit to a second #N# vault on #H# so more than one strategy is used.'],
  [[], 'Use one second feature of #N# on #H#, such as a vote, a claim page or a referral-free direct action, once.']
];
function secondFor(p, chain) { return pickTpl(SECONDS, p, 0, chain); }
function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; return t.length > 600 ? t.slice(0, 596) + '...' : t; }
// The same display format lib/model.ts prints into board.json.
function fmtMoney(n) {
  var neg = n < 0, a = Math.abs(n), s;
  if (a >= 100) s = String(Math.round(a));
  else if (a >= 10) s = (Math.round(a * 10) / 10).toFixed(1).replace(/\.0$/, '');
  else s = (Math.round(a * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
  return (neg ? '-$' : '$') + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// Plan economics, derived exactly as lib/model.ts derives them.
function planEcon(p) {
  var chain = chainOf(p), hold = holdFor(p.age_days);
  var high = chain === 'Ethereum' || chain === 'Bitcoin';
  var g1 = high ? 3 : 1, g2 = high ? 8 : 2, g3 = high ? 5 : 2, g4 = high ? 4 : 1;
  var weeks = Math.max(1, Math.ceil(hold / 7));
  var setupGas = g1 + g2 + g3, setupMins = 62, weeklyMins = 12, planMins = setupMins + weeklyMins * weeks;
  return { g1: g1, g2: g2, g3: g3, g4: g4, setupGas: setupGas, planGas: setupGas + g4 * weeks, setupMins: setupMins, weeklyMins: weeklyMins, planMins: planMins, hold: hold, chain: chain };
}
function farmSteps(p) {
  var e = planEcon(p), chain = e.chain, cap = capitalFor(p), hold = e.hold;
  var g1 = e.g1, g2 = e.g2, g3 = e.g3, g4 = e.g4;
  var sc = DATA.farm_scenario;
  var gross = (sc.reward_share_pct / 100) * p.implied_value_usd / sc.farmers;
  var expected = gross * (p.odds / 100);
  var net = expected - e.planGas;
  var perHour = net / (e.planMins / 60);
  var tbill = cap * (sc.tbill_pct / 100) * (hold / 365);
  var verdict = (perHour >= sc.farm_per_hour && net > tbill) ? 'FARM' : (net > 0 && perHour >= sc.thin_per_hour) ? 'THIN' : 'SKIP';
  var totals = 'TOTALS - ' + p.name + ': $' + cap + ' of working capital, about $' + e.setupGas + ' of setup gas plus $' + g4 + ' a week on ' + chain + ', ' + e.setupMins + ' minutes of setup and ' + e.weeklyMins + ' minutes a week, held ' + hold + '+ days.'
  + ' Scenario (stated, not a promise): rewards of ' + sc.reward_share_pct + '% of the ' + fmtMoney(p.implied_value_usd) + ' implied FDV split across ' + fmtInt(sc.farmers) + ' farmers give one farmer ' + fmtMoney(gross) + ' gross; at ' + p.odds + '% odds, expected ' + fmtMoney(expected) + '; net of ' + fmtMoney(e.planGas) + ' of gas and fees: ' + fmtMoney(net) + ' (~' + fmtMoney(perHour) + '/hour). A ' + sc.tbill_pct + '% T-bill on the same capital over this hold earns ' + fmtMoney(tbill) + '. Verdict: ' + verdict + '.';
  var steps = [
  ['SETUP - Use a fresh wallet that holds only the funds you plan to farm ' + p.name + ' with, and keep its seed phrase offline.', 'about $' + g1 + ' of gas for the first transaction on ' + chain, '5 minutes'],
  ['VERIFY - Check that you are on ' + p.name + '\'s real app before signing anything: reach it from the protocol\'s own listing or docs, compare the domain and contract address character by character, and never follow a claim or airdrop link sent by DM or search ad. Open only the points or rewards page ' + p.name + ' itself publishes, and never pay a third party to claim.', 'no fee to check - a fake site costs the whole position', '5 minutes'],
  ['FUND - Fund the farm wallet with $' + cap + ' of USDC plus a small gas buffer on ' + chain + '; if you bridge, bridge from an account you control and wait for the funds to settle before the first deposit.', '$' + cap + ' of capital to move, plus bridge or withdrawal fees where they apply', '10 minutes'],
  ['RISK - Read ' + p.name + '\'s risk surface before depositing: what backs the position, what can be paused or slashed, and whether rewards are paid in a token that does not trade yet; if the yield story is unclear, farm smaller or not at all.', 'no fee - reading only, and it decides the size', '10 minutes'],
  ['CORE - ' + actionFor(p, cap, chain), '$' + cap + ' of capital and about $' + g2 + ' of gas on ' + chain, '15 minutes to set up'],
  ['DEEPEN - ' + secondFor(p, chain), 'about $' + g3 + ' of gas on ' + chain, '10 minutes'],
  ['CADENCE - Repeat one qualifying action on ' + p.name + ' each week, on a different weekday, instead of doing everything in one day, and hold the position for at least ' + hold + ' days so the activity appears in more than one weekly snapshot.', 'about $' + g4 + ' of gas a week on ' + chain, '10 minutes a week'],
  ['WATCH - Watch the exit rule weekly: unwind the ' + p.name + ' position if its TVL prints below ' + fmtMoney(p.exit_tvl) + ' - a one-week drop of ' + (-DATA.farm_exit_pct) + '% or worse, worse than 95% of this snapshot\'s protocols manage in a week - or if withdrawals pause or the team announces a snapshot date.', 'nothing to watch - the exit itself costs normal gas', '2 minutes a week'],
  ['RECORD - Log every ' + p.name + ' transaction, date and balance in a farm log from the first deposit on; if a claim ever asks for proof of activity, the log is the proof.', 'nothing but the log', '5 minutes to set up'],
  [totals, 'no extra cost - this line is the total of the steps above', '2 minutes to read']
  ];
  return steps.map(function (s) { return stepText({ text: s[0], cost: s[1], time: s[2] }); });
}

function readHash() { var h = window.location.hash.replace(/^#/, ''); if (!h) return; var q = new URLSearchParams(h); if (q.get('q')) state.q = q.get('q'); if (q.get('p')) state.selected = q.get('p'); if (q.get('category')) state.category = q.get('category'); if (q.get('chain')) state.chain = q.get('chain'); if (q.get('tab')) state.tab = q.get('tab'); }
function writeHash() { var q = new URLSearchParams(); if (state.q) q.set('q', state.q); if (state.category !== 'all') q.set('category', state.category); if (state.chain !== 'all') q.set('chain', state.chain); if (state.selected) q.set('p', state.selected); var s = q.toString(); window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search); }

function rows() {
  var q = state.q.trim().toLowerCase();
  return DATA.rows.filter(function (r) {
  if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
  if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
  if (state.tier === 'watch' && !r.in_watchlist) return false;
  if (state.tier === 'early' && r.in_watchlist) return false;
  if (state.risk !== 'all' && r.risk !== state.risk) return false;
  if (state.starredOnly && !stars.has(r.slug)) return false;
  if (state.preset === 'watch' && !inWatch(r)) return false;
  if (state.preset === 'verdicts' && r.verdict !== 'FARM') return false;
  if (!q) return true;
  return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}
var SORTK = {
  name: function (r) { return r.name.toLowerCase(); }, tvl: function (r) { return r.tvl_usd; },
  growth: function (r) { return r.change_7d === null ? -1e9 : r.change_7d; }, farm: function (r) { return r.farm_score; },
  conf: function (r) { return r.confidence; }, odds: function (r) { return r.odds; }, neth: function (r) { return r.net_per_hour; },
  ev: function (r) { return r.opportunity_usd; }, age: function (r) { return r.age_days === null ? 1e9 : r.age_days; },
  implied: function (r) { return r.implied_value_usd; }
};
function sorted(list) {
  var kf = SORTK[state.sort] || SORTK.implied;
  return list.slice().sort(function (a, b) {
  var av = kf(a), bv = kf(b);
  if (av < bv) return -state.dir; if (av > bv) return state.dir;
  return a.slug < b.slug ? -1 : 1;
  });
}
function preset(name) {
  state.preset = name; state.dir = -1;
  if (name === 'farm' || name === 'ev' || name === 'watch' || name === 'verdicts') { state.tier = 'all'; state.risk = 'all'; }
  if (name === 'farm') state.sort = 'farm';
  if (name === 'ev') state.sort = 'ev';
  if (name === 'growth') state.sort = 'growth';
  if (name === 'safe') { state.sort = 'conf'; state.risk = 'Lower'; }
  if (name === 'early') { state.tier = 'early'; state.sort = 'farm'; }
  if (name === 'watch') state.sort = 'tvl';
  if (name === 'verdicts') state.sort = 'neth';
  if (name === 'all') { state.sort = 'implied'; state.tier = 'all'; state.risk = 'all'; state.category = 'all'; state.chain = 'all'; state.q = ''; state.starredOnly = false; }
  render();
}

function header() {
  var px = el('span', { class: 'pixels', 'aria-hidden': 'true' });
  ['p', '', 'p', '', 'p', '', 'p', 'p', 'p'].forEach(function (c) { px.appendChild(el('i', { class: c })); });
  return el('header', { class: 'top' }, el('div', { class: 'brand' }, px, el('span', { class: 'brand-name' }, 'PIXEL', el('b', null, 'RADAR'))), el('div', { class: 'top-meta' }, sp('Snapshot ' + DATA.as_of), sp('DefiLlama index'), sp(DATA.model_version), sp('offline')));
}
function lede() {
  var v = DATA.validation, f = DATA.fit;
  function fact(label, value, viz, note) {
  var d = el('div', { class: 'fact' }, sp(label), el('b', { text: value }));
  if (viz) d.appendChild(viz);
  if (note) d.appendChild(el('span', { class: 'viz-note', text: note }));
  return d;
  }
  var errs = el('div', { class: 'errs' }, el('div', { class: 'erow' }, sp('Fitted'), pbar(v.fitted.median_ape_pct), spn(v.fitted.median_ape_pct + '%')), el('div', { class: 'erow' }, sp('Baseline'), pbar(v.baseline.median_ape_pct, true), spn(v.baseline.median_ape_pct + '%')));
  var wf = DATA.validation_schemes.filter(function (s) { return s.name.indexOf('Walk-forward 50') === 0; })[0];
  var b = DATA.bands;
  return el('section', { class: 'lede' }, el('div', { class: 'intro' }, el('h1', { text: 'Token launch radar: ' + DATA.board_size + ' pre-token protocols, priced by a model fitted on the snapshot itself' }), pt('No hand-set multiples: a ridge regression of log market cap on log TVL, dampened 7-day growth, age and category/chain offsets, fitted on the ' + f.fit_rows + ' snapshot protocols whose token already trades, then tested on held-out protocols it never saw - median error ' + v.fitted.median_ape_pct + '% against ' + v.baseline.median_ape_pct + '% for a peer-median model (full test in Model check).')), el('div', { class: 'facts' }, fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, pbar(100), 'all 40 ranked'), fact('Held-out median error', v.fitted.median_ape_pct + '%', errs, 'fit on ' + f.fit_rows + ' tokens, ' + f.dropped_rows + ' outliers dropped'), fact('Walk-forward miss', 'x' + wf.fitted_x + ' typical', pbar(wf.fitted_x / wf.baseline_x * 100), 'older half trains, newer half priced: x' + wf.fitted_x + ' vs x' + wf.baseline_x), fact('Range honesty', b.cov50_pct + '% / ' + b.cov80_pct + '%', pbar(b.cov80_pct), 'scored on residuals they were not built from'), fact('Odds quality (Brier)', String(DATA.odds_eval.propensity.brier), pbar(DATA.odds_eval.propensity.brier / DATA.odds_eval.v4_method.brier * 100), 'fitted propensity vs ' + DATA.odds_eval.v4_method.brier + ' for the old base-rate method'), fact('Term gate', '1 kept of 6', pbar(17), 'dampened growth survived; placebo rejected')));
}
// The cover answers its own checks: every figure is recomputed from data.js.
function selfCheck() {
  var covered = DATA.rows.filter(function (r) { return r.in_watchlist; }).length;
  var s = DATA.ledger_summary;
  var vc = { FARM: 0, THIN: 0, SKIP: 0 };
  DATA.rows.forEach(function (r) { vc[r.verdict]++; });
  return el('div', { class: 'selfcheck', role: 'note' }, el('span', { class: 'sc-tag', text: 'SELF-CHECK' }), scItem('Watchlist covered', covered + '/' + DATA.watchlist_size), scItem('Board rows', String(DATA.board_size)), scItem('Already trading', String(DATA.live_size)), scItem('Self-graded (' + s.graded + ' unseen)', s.within_2x_pct + '% within 2x'), scItem('Board total implied', fmtUsd(DATA.total_implied_usd)), scItem('Verdicts FARM / THIN / SKIP', vc.FARM + ' / ' + vc.THIN + ' / ' + vc.SKIP));
}
// The full snapshot, accounted for: every protocol in exactly one group.
function accountingBar() {
  var total = DATA.accounting.reduce(function (s, g) { return s + g.n; }, 0);
  var kids = [el('span', { class: 'sc-tag', text: 'LEDGER ' + total })];
  DATA.accounting.forEach(function (g) { kids.push(scItem(g.label, String(g.n))); });
  return el.apply(null, ['div', { class: 'selfcheck', role: 'note' }].concat(kids));
}
function onPick(key, hash) { return function (v) { state[key] = v; if (hash) writeHash(); render(); }; }
function selectField(label, id, values, current, onchange) {
  var s = el('select', { id: id, 'aria-label': label }, values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: v[0] === current ? 'selected' : null }); }));
  s.addEventListener('change', function () { onchange(s.value); });
  return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
}
function controls() {
  var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
  var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocols...  ( / )', value: state.q, 'aria-label': 'Search' });
  search.addEventListener('input', function () { state.q = search.value; writeHash(); tableHost.textContent = ''; tableHost.appendChild(currentView()); });
  var farmCount = DATA.rows.filter(function (r) { return r.verdict === 'FARM'; }).length;
  var presets = el('div', { class: 'field' }, el('span', { class: 'flab', text: 'Preset views' }), el('div', { class: 'presets' },
  [['all', 'All'], ['ev', 'Top opportunity'], ['farm', 'Best to farm'], ['verdicts', 'Farm verdicts (' + farmCount + ')'], ['growth', 'Fast growth'], ['safe', 'Lower risk'], ['early', 'Early gems'], ['watch', 'Launch Watch (' + DATA.rows.filter(inWatch).length + ')']].map(function (p) {
  return btn(p[1], function () { preset(p[0]); }, state.preset === p[0] ? 'on' : '');
  })));
  var tabs = el('div', { class: 'field' }, el('span', { class: 'flab', text: 'View' }), el('div', { class: 'tabs' },
  [['pre', 'Pre-token board'], ['live', 'Live tokens'], ['model', 'Model check'], ['ledger', 'Accuracy Ledger']].map(function (t) {
  return btn(t[1], function () { state.tab = t[0]; render(); }, state.tab === t[0] ? 'on' : '');
  })));
  var starBtn = btn('My farm list (' + stars.size + ')', function () { state.starredOnly = !state.starredOnly; render(); }, state.starredOnly ? 'on' : '');
  var exp = btn('Export CSV', exportCsv);
  return el('div', { class: 'controls' }, el('div', { class: 'rowflex' }, el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
  selectField('Category', 'category', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), state.category, onPick('category', 1)),
  selectField('Chain', 'chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, onPick('chain', 1)),
  selectField('Tier', 'tier', [['all', 'Watchlist + early'], ['watch', 'Watchlist only'], ['early', 'Early only']], state.tier, onPick('tier')),
  selectField('Risk', 'risk', [['all', 'Any risk'], ['Lower', 'Lower'], ['Medium', 'Medium'], ['High', 'High']], state.risk, onPick('risk')),
  tabs), el('div', { class: 'rowflex' }, presets, starBtn, exp, el('span', { class: 'count', id: 'count', text: '' })));
}
function exportCsv() {
  var lines = ['rank,slug,name,category,tvl_usd,change_7d,implied_value_usd,odds,opportunity_usd,farm_score,confidence,risk,capital_usd'];
  sorted(rows()).forEach(function (r) { lines.push([r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.implied_value_usd, r.odds, r.opportunity_usd, r.farm_score, r.confidence, r.risk, r.capital_usd].join(',')); });
  var a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'pixel-radar-board.csv' });
  document.body.appendChild(a); a.click(); a.remove();
}
function sortHead(key, label) { return el('th', { scope: 'col' }, btn(label + (state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : ''), function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); })); }
var tableHost = el('div');
function boardTable() {
  var list = sorted(rows());
  var c = document.getElementById('count'); if (c) c.textContent = list.length + ' rows shown';
  if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('h2', { text: 'No protocol matches' }), pt('Clear the search or pick another filter.'), btn('Reset all', function () { preset('all'); })));
  var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
  var tb = el('tbody');
  list.forEach(function (r) {
  var star = btn(stars.has(r.slug) ? 'FARMING' : '+ FARM', function (e) { e.stopPropagation(); if (stars.has(r.slug)) stars.delete(r.slug); else stars.add(r.slug); render(); }, 'mini' + (stars.has(r.slug) ? ' on' : ''));
  var nameKids = [el('b', { text: r.name })];
  if (r.weak_cat) nameKids.push(el('span', { class: 'badge', text: 'WEAK CATEGORY' }));
  nameKids.push(ss(r.category || 'Other'));
  tb.appendChild(el('tr', { class: state.selected === r.slug ? 'sel' : '', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); } }, tdn(String(r.rank)), el('td', null, el('span', { class: 'name' }, nameKids)), el('td', null, el('span', { class: 'badge' + (r.in_watchlist ? ' w' : ''), text: r.in_watchlist ? 'WATCHLIST' : 'EARLY' })), el('td', { class: 'num' }, inWatch(r) ? [document.createTextNode(fmtUsd(r.tvl_usd)), el('div', { class: 'floorwrap' }, pbar(floorPct(r)), ss('FLOOR ' + floorPct(r) + '%'))] : fmtUsd(r.tvl_usd)), el('td', { class: 'num' }, r.change_7d === null ? 'n/a' : [vbar(Math.sqrt(Math.min(Math.abs(r.change_7d), 100)) * 10, r.change_7d < 0), el('span', { class: r.change_7d >= 0 ? 'pos' : 'neg', text: fmtPct(r.change_7d) })]), el('td', null, seg(r.farm_score), spn(String(r.farm_score))), el('td', null, vbar(r.odds), spn(r.odds + '%')), tdn(fmtUsd(r.opportunity_usd)), el('td', null, el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round(r.implied_value_usd / max * 100)) + '%' })), spn(fmtUsd(r.implied_value_usd))), el('td', null, el('span', { class: 'badge' + (r.verdict === 'FARM' ? ' w' : r.verdict === 'SKIP' ? ' rh' : ''), text: r.verdict })), tdn(fmtMoney(r.net_per_hour) + '/h'), el('td', null, star)));
  });
  return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null, el('caption', { text: 'Ranked by implied value. Odds = fitted propensity; EV = implied x odds x confidence; verdict and net/h are the farm plan\'s netted result (Model check).' }), el('thead', null, el('tr', null, sortHead('implied', '#'), sortHead('name', 'Protocol'), th('Tier'), sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('farm', 'Farm score'), sortHead('odds', 'Odds'), sortHead('ev', 'EV index'), sortHead('implied', 'Implied value'), th('Verdict'), sortHead('neth', 'Net/h'), th('Actions'))), tb)), el('p', { class: 'sub pad', text: 'WEAK CATEGORY: a category the model prices badly when it has never seen it (leave-one-category-out median error 150%+; Model check names them); its confidence is capped at Low.' }));
}
function weeklyHours(r) { return r.farm_hours / (r.hold_days / 7); }
function autoPick() {
  var cand = DATA.rows.filter(function (r) { return r.net_usd > 0; }).slice().sort(function (a, b) { return b.net_per_hour - a.net_per_hour || (a.slug < b.slug ? -1 : 1); });
  var picked = [], cap = 0, hrs = 0, perCat = {}, perChain = {};
  cand.forEach(function (r) {
  var cat = r.category || 'Other', ch = (r.chains || [])[0] || 'None';
  if ((perCat[cat] || 0) >= 2 || (perChain[ch] || 0) >= 3) return;
  if (cap + r.capital_usd > state.portBudget || hrs + weeklyHours(r) > state.portHours) return;
  picked.push(r); cap += r.capital_usd; hrs += weeklyHours(r);
  perCat[cat] = (perCat[cat] || 0) + 1; perChain[ch] = (perChain[ch] || 0) + 1;
  });
  stars = new Set(picked.map(function (r) { return r.slug; }));
  render();
}
function portfolioPanel() {
  var picked = DATA.rows.filter(function (r) { return stars.has(r.slug); });
  var cap = 0, net = 0, hrs = 0;
  picked.forEach(function (r) { cap += r.capital_usd; net += r.net_usd; hrs += weeklyHours(r); });
  var bud = el('input', { type: 'number', id: 'pb', value: String(state.portBudget), min: '0', 'aria-label': 'Capital budget' });
  bud.addEventListener('change', function () { state.portBudget = Math.max(0, parseFloat(bud.value) || 0); });
  var hrsIn = el('input', { type: 'number', id: 'ph', value: String(state.portHours), min: '0', step: '0.5', 'aria-label': 'Weekly hours budget' });
  hrsIn.addEventListener('change', function () { state.portHours = Math.max(0, parseFloat(hrsIn.value) || 0); });
  return el('div', { class: 'panel' }, el('div', { class: 'pad' }, el('h2', { text: 'Portfolio picker - greedy by net per hour' }), ps('Auto-pick walks plans with a positive expected net by net per hour, best first, taking each only while the budgets hold: capital within budget, weekly hands-on time within budget, at most 2 per category and 3 per primary chain. Picking replaces the farm list.'), el('div', { class: 'rowflex' }, el('div', { class: 'field' }, el('label', { for: 'pb', text: 'Capital budget $' }), bud), el('div', { class: 'field' }, el('label', { for: 'ph', text: 'Hours per week' }), hrsIn), btn('Auto-pick portfolio', autoPick)), pt('Portfolio: ' + picked.length + ' protocols - ' + fmtUsd(cap) + ' of ' + fmtUsd(state.portBudget) + ' capital - expected net ' + fmtMoney(net) + ' - ' + hrs.toFixed(1) + ' of ' + state.portHours + ' weekly hours - blended ' + (hrs > 0 ? fmtMoney(net / hrs) : '$0') + ' per weekly hour.')));
}
function currentView() {
  if (state.tab === 'pre') {
  if (!state.starredOnly) return boardTable();
  var wrap = el('div', null, portfolioPanel());
  wrap.appendChild(boardTable());
  return wrap;
  }
  return state.tab === 'live' ? liveView() : state.tab === 'ledger' ? ledgerView() : modelView();
}
function ledgerView() {
  var s = DATA.ledger_summary;
  var maxA = Math.max.apply(null, DATA.ledger.map(function (l) { return l.ape_pct; })) || 1;
  var list = DATA.ledger.slice().sort(function (a, b) { var d = (a.ape_pct - b.ape_pct) * state.lerr; return d !== 0 ? d : (a.slug < b.slug ? -1 : 1); });
  var tb = el('tbody');
  list.forEach(function (l) {
  var chip = l.verdict === 'WITHIN 2X' ? 'badge w' : l.verdict === 'OVER 5X' ? 'badge rh' : 'badge';
  tb.appendChild(el('tr', null, el('td', null, el('span', { class: 'name' }, el('b', { text: l.name }), ss(l.category || 'Other'))), tdn(fmtUsd(l.tvl_usd)), tdn(fmtUsd(l.predicted_usd)), tdn(fmtUsd(l.actual_usd)), el('td', { class: 'num' }, vbar(Math.log10(1 + l.ape_pct) / Math.log10(1 + maxA) * 100, false, 90), sp(l.ape_pct + '%')), el('td', null, el('span', { class: chip, text: l.verdict }))));
  });
  function lfact(label, value, note) { return el('div', { class: 'fact' }, sp(label), el('b', { text: value }), el('span', { class: 'viz-note', text: note })); }
  return el('div', { class: 'panel' }, el('div', { class: 'lfacts' },
  lfact('Tokens graded', String(s.graded), 'every fitted live token, priced leave-one-out'),
  lfact('Within 2x', s.within_2x_pct + '%', 'within a factor of two of the recorded cap'),
  lfact('Median error', s.median_ape_pct + '%', 'the leave-one-out figure - identical by construction')), el('div', { class: 'pad' }, ps('The radar grading itself in public: each row is one live token from the fit set, priced leave-one-out - by a refit that never saw it - against the cap the snapshot recorded. The median above is the leave-one-out median Model check reports, by construction. WITHIN 2X = within a factor of two; 2-5X = within five; OVER 5X = further out. Error bars are log-scaled. No row is hidden.')), el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, th('Token'), th('TVL'), th('Predicted (leave-one-out)'), th('Actual'), el('th', null, btn('Error ' + (state.lerr > 0 ? '^' : 'v'), function () { state.lerr = -state.lerr; render(); })), th('Verdict'))), tb)));
}

function liveView() {
  var tb = el('tbody');
  DATA.live.forEach(function (r) { tb.appendChild(el('tr', null, el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), ss((r.category || 'Other') + ' - ' + (r.chains || []).slice(0, 2).join(', ')))), tdn(fmtUsd(r.tvl_usd)), tdn(fmtUsd(r.mcap_usd)), tdn(r.ratio === null ? 'n/a' : r.ratio + 'x'), el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }), el('td', null, el('span', { class: 'badge', text: 'ALREADY TRADES' })))); });
  return el('div', { class: 'panel' }, el('p', { class: 'sub pad', text: 'Live tokens are evidence, not entries - fitted on, never ranked.' }), mt(['Protocol', 'TVL', 'Market cap', 'Mcap/TVL', '7d', 'Token'], tb));
}
function schemeRow(s) {
  return el('tr', null, td(s.name + ' (n=' + s.n + ')'), tdn(s.fitted.median_ape_pct + '%'), tdn('x' + s.fitted_x), tdn(s.baseline.median_ape_pct + '%'), tdn('x' + s.baseline_x), tdn('x' + s.factor.toFixed(2)), tdn(String(s.fitted.r2_log)));
}
function gateRow(g) {
  var mark = g.kept === true ? 'KEPT' : g.kept === false ? 'REJECTED' : '-';
  return el('tr', null, td(g.name), tdn(g.loo_pct + '%' + (g.loo_x ? ' (x' + g.loo_x + ')' : '')), tdn(g.wf_pct + '%' + (g.wf_x ? ' (x' + g.wf_x + ')' : '')), td(mark));
}
function modelView() {
  var f = DATA.fit, v = DATA.validation;
  var coef = el('tbody');
  var scTb = el('tbody');
  DATA.validation_schemes.forEach(function (s) { scTb.appendChild(schemeRow(s)); });
  [['Intercept (at mean log TVL)', f.intercept], ['Log TVL (elasticity)', f.log_tvl], ['7-day growth, dampened', f.growth], ['Log age, per log day', f.log_age]].forEach(function (r) {
  coef.appendChild(el('tr', null, td(r[0]), tdn(String(r[1]))));
  });
  var catTb = el('tbody');
  DATA.categories.slice(0, 16).forEach(function (c) { catTb.appendChild(el('tr', null, td(c.category), tdn(String(c.peers)), tdn((c.offset >= 0 ? '+' : '') + c.offset), tdn(c.peer_multiple + 'x'), tdn(c.base_rate_pct + '%'), tdn(String(c.live_count)), tdn(String(c.board_count)))); });
  var gateTb = el('tbody');
  DATA.gating.forEach(function (g) { gateTb.appendChild(gateRow(g)); });
  var oddsTb = el('tbody');
  oddsTb.appendChild(el('tr', null, td('Fitted propensity (logistic, shipped)'), tdn(String(DATA.odds_eval.propensity.brier)), tdn(String(DATA.odds_eval.propensity.auc))));
  oddsTb.appendChild(el('tr', null, td('Radar-3 method (base rate + adjustments)'), tdn(String(DATA.odds_eval.v4_method.brier)), tdn(String(DATA.odds_eval.v4_method.auc))));
  var bandTb = el('tbody');
  bandTb.appendChild(el('tr', null, td('50% range (P25-P75)'), tdn('x' + DATA.bands.f50[0] + ' to x' + DATA.bands.f50[1]), tdn('50%'), tdn(DATA.bands.cov50_pct + '%')));
  bandTb.appendChild(el('tr', null, td('80% range (P10-P90)'), tdn('x' + DATA.bands.f80[0] + ' to x' + DATA.bands.f80[1]), tdn('80%'), tdn(DATA.bands.cov80_pct + '%')));
  var chTb = el('tbody');
  DATA.chain_offsets.slice().sort(function (a, b) { return b.peers - a.peers; }).slice(0, 10).forEach(function (c) { chTb.appendChild(el('tr', null, td(c.chain), tdn(String(c.peers)), tdn((c.offset >= 0 ? '+' : '') + c.offset))); });
  var bs = DATA.bootstrap, lc = DATA.loco;
  return el('div', null, msec('Model check - held-out validation', pt('The fit set is the ' + f.candidate_rows + ' protocols whose token trades with a recorded cap and real TVL (exchanges excluded). A fixed outlier rule drops any whose cap/TVL multiple falls outside [' + f.mult_band[0] + ', ' + f.mult_band[1] + '] - a mismatched record, not a valuation - leaving ' + f.fit_rows + ' rows. Validation is deterministic 2-fold cross-fitting: each half is priced by a model trained only on the other half - every error below is on a protocol the model never saw.'), pt('Mean errors tell the same story (' + v.fitted.mean_ape_pct + '% fitted vs ' + v.baseline.mean_ape_pct + '% baseline); a 50/50 blend of the two was tested and dropped - it won only on mean error. The fitted model ships alone. A median error near 75% is the honest state of pricing pre-token protocols from TVL: read implied values as orders of magnitude.'), el('h3', { text: 'Tested four ways' }), mt(['Split', 'Fitted median', 'Fitted x', 'Baseline median', 'Baseline x', 'Factor', 'R2 (log)'], scTb), pt('The x columns are the typical multiplicative miss: exp of the median absolute log error. Walk-forward splits by listing date (80 of the ' + f.fit_rows + ' fitted tokens carry one). On the newest 20 the fitted R2 goes negative - recent launch levels drift - yet the median error stays lowest under every split. The claim is a stable median error (74.7-78.9%), not a stable R2.'), el('h3', { text: 'The term gate - every change on trial' }), pt('No term enters on intuition: each candidate is fitted behind a mask and scored on leave-one-out AND walk-forward; it ships only if it lowers the median error on BOTH. Build-up rows assemble the model; candidates face radar-3, the incumbent. The placebo is the control - the next protocol\'s growth, which cannot carry information: best leave-one-out score in the table, still rejected on walk-forward. One split is never enough. The last block is a second test round: all rejected.'), mt(['Term', 'Leave-one-out', 'Walk-forward 50', 'Verdict'], gateTb), el('h3', { text: 'Leave-one-category-out - and the weak categories' }), pt('The hardest test: refit without a whole category and price it - pooled median error ' + lc.pooled_median_ape_pct + '% over ' + lc.n + ' tokens (categories with 3+ fitted peers). Worst: ' + lc.worst.map(function (w) { return w.category + ' ' + w.median_ape_pct + '% (n=' + w.n + ')'; }).join(', ') + '. Categories at 150%+ - ' + lc.weak.join(', ') + ' - are flagged WEAK CATEGORY, confidence capped at Low.'), el('h3', { text: 'Ranges that keep their word' }), pt('Two ranges per row, split-conformal from the leave-one-out residuals - one global pair (the radar-3 per-category band was dropped: realized coverage 40.7% vs its 50% label). Coverage below is scored on the separate 2-fold residuals, errors the ranges were never derived from. ' + DATA.bands.within3_loo_pct + '% of leave-one-out predictions land within x3 of the recorded cap; ' + DATA.bands.within3_wf50_pct + '% under walk-forward.'), mt(['Range', 'Factors', 'Stated', 'Verified coverage'], bandTb), el('p', null, btn('Open the Accuracy Ledger - all ' + DATA.ledger_summary.graded + ' graded tokens, one by one', function () { state.tab = 'ledger'; render(); }))), msec('Fitted coefficients', el('div', { class: 'formula', text: 'log(implied) = ' + f.intercept + ' + ' + f.log_tvl + ' x (log TVL - ' + f.mean_log_tvl + ') + ' + f.growth + ' x sign(c) x log1p(|c|) / 100, c = clip(change_7d, -60, 120) + ' + f.log_age + ' x log1p(age) + category offset + chain offset - ridge penalties 3 (category), 6 (chain)' }), mt(['Term', 'Coefficient'], coef), pt('Read: cap scales at TVL^' + f.log_tvl + ' - doubling TVL multiplies expected cap by about ' + Math.pow(2, f.log_tvl).toFixed(2) + 'x, not 2x. Growth is dampened (log-shaped): a +100% week moves the price far less than twice a +50% week; the linear shape was the walk-forward culprit in the gate table and was replaced. Age\'s coefficient is near zero once size and category are counted.'), pt('Bootstrap, ' + bs.refits + ' refits on resampled fit sets: size is ' + f.log_tvl + ' +/- ' + bs.se_log_tvl + ' - tight. Growth is ' + f.growth + ' +/- ' + bs.se_growth + ': the error exceeds the estimate, so the dampened term stands on its gate evidence (won both splits), not its own precision. Log age ' + f.log_age + ' +/- ' + bs.se_log_age + ' - zero for value. Category offset errors run ' + bs.cat_se_min + '-' + bs.cat_se_max + '. Ranks are soft: the median row\'s 80% range is ' + bs.median_rank_width + ' places wide; the top row holds at #' + bs.top_range[0] + '-' + bs.top_range[1] + '. Trust the top more than the middle.')), msec('Category offsets, base rates and peer evidence', mt(['Category', 'Fit peers', 'Fit offset', 'Peer median', 'Base rate', 'Trading', 'Waiting'], catTb), pt('Peer evidence: every multiple, offset and count above is read from live-token protocols in the same snapshot. The model uses the offsets; the medians are the baseline\'s yardstick. The base rate (share of a category already trading, shrunk toward the global ' + DATA.global_base_rate_pct + '%) is printed as a reference only - it is no longer how the odds are made.')), msec('Launch odds - a fitted propensity, not a base rate', pt('The odds are a ridge logistic regression fitted on the snapshot itself: the ' + DATA.odds_eval.rows + ' protocols that already record a token or sit on this board, scored on log age, category, clipped growth and chain count. No TVL term, no hand adjustments, no calibration layer (a cross-fitted Platt map was rejected). Both methods are scored out-of-fold on the same folds:'), mt(['Odds method', 'Brier (lower wins)', 'AUC (higher wins)'], oddsTb), pt('Against the field\'s slogans: age HELPS a launch, strongly - dropping age is the costliest ablation in the odds fit - while for VALUE the same log-age term is zero (above). Each drawer also shows forward odds: the share of still-tokenless protocols at that age recording a token within 12 months, from a one-term cohort curve - a projection under a stationarity assumption, not a backtest.')), msec('Chain offsets (top 10)', mt(['Chain', 'Fit peers', 'Fit offset'], chTb)), msec('Farm verdicts - netted, benchmarked, stress-tested', pt('Every plan ends in a netted verdict under one stated scenario, printed in the plan itself: rewards total ' + DATA.farm_scenario.reward_share_pct + '% of implied FDV split across ' + fmtInt(DATA.farm_scenario.farmers) + ' farmers; one farmer\'s gross is weighted by the odds, gas and fees come off, the net is divided by hands-on time. Capital is never subtracted. FARM needs ' + fmtMoney(DATA.farm_scenario.farm_per_hour) + '/h+ AND a net above a ' + DATA.farm_scenario.tbill_pct + '% T-bill on the same capital over the hold; THIN is a positive net at ' + fmtMoney(DATA.farm_scenario.thin_per_hour) + '/h+; else SKIP. Each drawer stress-tests across six neighbouring scenarios (share 0.25%/0.5% x 250/500/2000 farmers) with break-evens printed. Exit rule: unwind on a one-week TVL drop of ' + (-DATA.farm_exit_pct) + '% or worse - the snapshot\'s 5th percentile.')), msec('Limits - what this snapshot cannot say', pt('Supply-side checks cannot be run here: a pre-token protocol has no supply yet, so burns, unlocks and emissions have nothing to measure - any score claiming them for a token that does not exist is inventing data. Team track records are likewise absent (protocols, not wallets), which is why the drawer shows the category\'s priced peers instead.')));
}
// Protocol certificate identicon: deterministic 5x5 pixel fingerprint of the slug.
function identicon(slug) {
  var h = 2166136261; for (var i = 0; i < slug.length; i++) { h ^= slug.charCodeAt(i); h = Math.imul(h, 16777619); }
  var seed = h >>> 0;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; }
  var cells = '';
  function rect(x, y, col) { return '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + col + '"/>'; }
  for (var y = 0; y < 5; y++) for (var x = 0; x < 3; x++) {
  if (rnd() >= 0.5) continue;
  var col = rnd() < 0.2 ? '#14f195' : rnd() < 0.62 ? '#8b5cf6' : '#f4f4f1';
  cells += rect(x, y, col);
  if (x !== 2) cells += rect(4 - x, y, col);
  }
  return '<svg viewBox="0 0 5 5" width="84" height="84" aria-hidden="true" style="background:#0a0a0d;image-rendering:pixelated">' + cells + '</svg>';
}
function certText(row) {
  return ['PIXEL RADAR - PROTOCOL CERTIFICATE', row.name + ' (' + row.slug + ')', 'Rank #' + row.rank + ' of ' + DATA.board_size + ' - ' + (row.category || 'Other') + ' on ' + (row.chains || []).join(', '), 'Implied FDV ' + fmtUsd(row.implied_value_usd) + ' - Launch odds ' + row.odds + '% - EV index ' + fmtUsd(row.opportunity_usd), 'Model ' + DATA.model_version + ' - snapshot ' + DATA.as_of].join('\n');
}
var dialog = el('dialog', { class: 'detail', id: 'detail' });
dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
function eqRow(label, value, tot) { return el('div', null, sp(label), el('b', { class: 'num' + (tot ? ' tot' : ''), text: value })); }
function td(t) { return el('td', { text: t }); }
function tdn(t) { return el('td', { class: 'num', text: t }); }
function th(t) { return el('th', { text: t }); }
function pt(t) { return el('p', { text: t }); }
function ps(t) { return el('p', { class: 'sub', text: t }); }
function mt(h, body) { return el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, h.map(function (x) { return th(x); }))), body)); }
function btn(t, fn, cls) { return el('button', { type: 'button', text: t, class: cls || null, onclick: fn }); }
function sp(t) { return el('span', { text: t }); }
function ss(t) { return el('span', { class: 'sub', text: t }); }
function spn(t) { return el('span', { class: 'num', text: t }); }
function msec(t) { var a = ['section', { class: 'panel model' }, el('h2', { text: t })]; for (var i = 1; i < arguments.length; i++) a.push(arguments[i]); return el.apply(null, a); }
function dsec(t) { var a = ['section', { class: 'detail-section' }, el('h3', { text: t })]; for (var i = 1; i < arguments.length; i++) a.push(arguments[i]); return el.apply(null, a); }
function scItem(label, val) { return el('span', { class: 'sc-item' }, el('span', { class: 'sc-lab', text: label }), el('b', { text: val })); }
function catInfo(name) { var c = DATA.categories.filter(function (x) { return x.category === name; })[0]; return c || null; }
function chainOffset(name) { var c = DATA.chain_offsets.filter(function (x) { return x.chain === name; })[0]; return c ? c.offset : 0; }
function openDetail(slug) {
  var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0]; if (!row) return;
  state.selected = slug; writeHash();
  dialog.textContent = '';
  var steps = farmSteps(row); var key = row.slug; if (!done[key]) done[key] = steps.map(function () { return false; });
  var ci = catInfo(row.category || 'Other');
  var ageTerm = DATA.fit.log_age * Math.log1p(row.age_days === null ? DATA.fit.median_age_days : row.age_days);
  dialog.appendChild(el('div', { class: 'detail-head' }, el('div', null, ss('Rank ' + row.rank + ' of ' + DATA.board_size + ' - ' + (row.in_watchlist ? 'WATCHLIST' : 'EARLY') + ' - risk ' + row.risk + (row.pass_through ? ' - PASS-THROUGH' : '')), el('h2', { text: row.name }), ps((row.category || 'Other') + ' on ' + (row.chains || []).join(', '))), btn('Close X', function () { dialog.close(); })));
  var gSize = DATA.gating[1], gCat = DATA.gating[2];
  var rejected = DATA.gating.filter(function (g) { return g.kind === 'candidate' && g.kept === false; }).map(function (g) { return g.name + ' (LOO ' + g.loo_pct + '% / WF ' + g.wf_pct + '%)'; }).join('; ');
  dialog.appendChild(dsec('Valuation breakdown - fitted model', el('div', { class: 'eq' }, eqRow('TVL', fmtUsd(row.tvl_usd)), eqRow('Fitted multiple (implied / TVL)', row.fitted_multiple + 'x'), eqRow('Size curve - held-out after adding (LOO/WF)', gSize.loo_pct + '% / ' + gSize.wf_pct + '%'), eqRow('Category offset (' + (row.category || 'Other') + ', ' + row.peer_count + ' fit peers)', ci ? String(ci.offset) : '0 (no fit peers)'), eqRow('Category offsets - held-out after adding (LOO/WF)', gCat.loo_pct + '% / ' + gCat.wf_pct + '%'), eqRow('Primary chain offset (' + chainOf(row) + ')', String(chainOffset(chainOf(row)))), eqRow('7d growth term (dampened)', (row.growth_part >= 0 ? '+' : '') + row.growth_part + ' log'), eqRow('Age with no token / age term', fmtAge(row.age_days) + ' / ' + ageTerm.toFixed(4) + ' log'), eqRow('Peer-median baseline multiple', row.peer_multiple + 'x'), eqRow('Launch odds (fitted propensity; base ' + row.base_rate_pct + '%)', row.odds + '%'), eqRow('Forward odds, next 12m (cohort projection)', row.fwd_pct === null ? 'n/a - no listing date' : '~' + row.fwd_pct + '%'), eqRow('EV index (implied x odds x confidence)', fmtUsd(row.opportunity_usd)), eqRow('Confidence / Farm score', row.confidence + '% / ' + row.farm_score), eqRow('Capital to farm / hold', '$' + row.capital_usd + ' / ' + row.hold_days + 'd'), eqRow('Est. launch window (heuristic)', row.launch_window), eqRow('Bootstrap rank range (200 refits)', '#' + row.rank_lo + ' - #' + row.rank_hi), eqRow('Range P25-P75 (conformal, verified ' + DATA.bands.cov50_pct + '%)', fmtUsd(row.band50_lo_usd) + ' - ' + fmtUsd(row.band50_hi_usd)), eqRow('Range P10-P90 (verified ' + DATA.bands.cov80_pct + '%)', fmtUsd(row.band80_lo_usd) + ' - ' + fmtUsd(row.band80_hi_usd)), eqRow('Implied value', fmtUsd(row.implied_value_usd), true)), ps('Tested, not used: ' + rejected + ' - a candidate ships only if it lowers the median error on BOTH splits (full gate in Model check). Page check: recomputed from the published fit = ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ' - matches board.json exactly.' : ' - differs, data is stale.') + ' Estimate only: no token is recorded; that is not a promise one will launch.')));
  var certId = el('div', { class: 'cid' }); certId.innerHTML = identicon(row.slug);
  dialog.appendChild(dsec('Protocol certificate', el('div', { class: 'cert' }, certId, el('div', { class: 'cfields' }, el('div', { class: 'eq' }, eqRow('Protocol', row.name), eqRow('Rank', '#' + row.rank + ' of ' + DATA.board_size), eqRow('Implied FDV', fmtUsd(row.implied_value_usd)), eqRow('Launch odds / EV index', row.odds + '% / ' + fmtUsd(row.opportunity_usd)), eqRow('Model / snapshot', DATA.model_version + ' / ' + DATA.as_of)))), ps('Deterministic from the slug.'), el('div', { class: 'rowflex' }, btn('Copy certificate', function () { if (navigator.clipboard) navigator.clipboard.writeText(certText(row)); }), btn('Copy link', function () { if (navigator.clipboard) navigator.clipboard.writeText(window.location.href.split('#')[0].split('?')[0] + '?protocol=' + row.slug); }))));
  if (row.peers && row.peers.length) {
  var pTb = el('tbody');
  row.peers.forEach(function (pp) { pTb.appendChild(el('tr', null, td(pp.name), tdn(fmtUsd(pp.tvl_usd)), tdn(fmtUsd(pp.cap_usd)), tdn(pp.cap_tvl + 'x'), tdn(pp.cap_model + 'x'))); });
  dialog.appendChild(dsec('Nearest priced peers (same category, by TVL)', mt(['Token', 'TVL', 'Cap', 'Cap / TVL', 'Cap / model'], pTb), ps('Cap / model: recorded cap over the model\'s price for that peer.')));
  }
  if (inWatch(row)) {
  dialog.appendChild(dsec('Launch Watch - near the board floor', el('div', { class: 'progress' }, el('i', { style: 'width:' + floorPct(row) + '%' })), ps('FLOOR ' + floorPct(row) + '% -> $50M board. At ' + fmtUsd(row.tvl_usd) + ' TVL this sits in the $35-50M band, closest to crossing into the board\'s top tier.')));
  }
  var prog = el('div', { class: 'progress' }, el('i', { style: 'width:0%' }));
  var list = el('ol', { class: 'steps' });
  function refreshProg() { var n = done[key].filter(Boolean).length; prog.firstChild.style.width = Math.round(n / steps.length * 100) + '%'; }
  steps.forEach(function (s, i) {
  var at = s.indexOf(' Cost: '); var action = at >= 0 ? s.slice(0, at) : s; var tail = at >= 0 ? s.slice(at + 1) : '';
  var box = el('input', { type: 'checkbox', checked: done[key][i] ? 'checked' : null });
  box.addEventListener('change', function () { done[key][i] = box.checked; refreshProg(); });
  list.appendChild(el('li', null, el('label', null, box, sp(action)), el('span', { class: 'cost', text: tail })));
  });
  var tbillRow = row.capital_usd * (DATA.farm_scenario.tbill_pct / 100) * (row.hold_days / 365);
  var vchip = el('div', { class: 'vchip ' + row.verdict.toLowerCase() }, sp('NET VERDICT: ' + row.verdict + ' - ~' + fmtMoney(row.net_usd) + ' expected net - ~' + fmtMoney(row.net_per_hour) + '/h under the stated scenario - a ' + DATA.farm_scenario.tbill_pct + '% T-bill on this capital earns ' + fmtMoney(tbillRow) + ' - farms in ' + row.farm_cells + ' of 6 scenarios - break-even share ' + (row.be_share_pct === null ? 'n/a' : row.be_share_pct + '%') + ' / odds ' + row.be_odds_pct + '% - exit if TVL prints below ' + fmtUsd(row.exit_tvl)));
  dialog.appendChild(dsec('Farm plan - check steps off as you do them', vchip, prog, list, el('div', { class: 'rowflex' }, btn('Copy farm plan', function () { if (navigator.clipboard) navigator.clipboard.writeText(row.name + ' farm plan\n' + steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n')); }), btn(stars.has(row.slug) ? 'Farming - saved' : 'Add to farm list', function () { stars.add(row.slug); render(); openDetail(row.slug); }))));
  refreshProg();
  if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  setTimeout(fixGradients, 0);
}
function render() {
  app.textContent = '';
  var shell = el('div', { class: 'shell' });
  shell.appendChild(header()); shell.appendChild(lede()); shell.appendChild(selfCheck()); shell.appendChild(accountingBar()); shell.appendChild(controls());
  tableHost.textContent = ''; tableHost.appendChild(currentView());
  shell.appendChild(tableHost);
  shell.appendChild(el('p', { class: 'foot', text: 'PIXEL RADAR - ' + DATA.model_version + ' - snapshot ' + DATA.as_of + ' - implied values are model claims, not prices or promises.' }));
  app.appendChild(shell);
  if (!dialog.isConnected) app.appendChild(dialog);
  app.setAttribute('aria-busy', 'false');
  window.__shotReady = true;
  setTimeout(fixGradients, 0);
  if (state.selected) openDetail(state.selected);
}
readHash();
var qp = new URLSearchParams(window.location.search);
if (qp.get('protocol')) state.selected = qp.get('protocol');
render();
document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); var q = document.getElementById('q'); if (q) q.focus(); } if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
