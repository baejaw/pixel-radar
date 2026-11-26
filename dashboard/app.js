// PIXEL RADAR dashboard. Reads window.RADAR (written beside dashboard/ by main.ts)
// and renders: a comparables-ranked board, filters and presets, a per-protocol
// detail drawer with the full valuation breakdown and a checkable farm plan,
// a peer-evidence view, a live-token view, a compare tray, a farm list, a CSV
// export and a Model Lab that re-ranks the board live under other weights.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', risk: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, starredOnly: false, preset: 'all', gw: 0.5, pw: 0.65 };
  var stars = new Set(); var compare = []; var done = {};

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K'; return usd.format(n); }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return '?'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  // The page recomputes a row from the same rounded multipliers board.json used,
  // so the detail view's number is the board's number, not a second estimate.
  function impliedOf(r) { return Math.max(1, Math.round(r.tvl_usd * r.effective_multiple * r.growth_multiplier * r.maturity_multiplier * r.chain_multiplier)); }
  function labImplied(r) {
    var g = clamp(r.change_7d === null ? 0 : r.change_7d, DATA.model.growth_floor, DATA.model.growth_cap);
    var gm = r4(1 + (g / 100) * state.gw);
    var eff = r4(clamp(state.pw * r.peer_multiple + (1 - state.pw) * DATA.global_multiple, DATA.model.multiple_floor, DATA.model.multiple_cap));
    return Math.max(1, Math.round(r.tvl_usd * eff * gm * r.maturity_multiplier * r.chain_multiplier));
  }
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

  // Farm plan: the same derivation lib/model.ts writes into board.json — category,
  // first chain, TVL tier and age decide every action, cost and hold. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; if (p.tvl_usd >= 2e7) return 75; return 50; }
  function holdFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function actionFor(p, cap, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + cap + ' of USDC to ' + n + ' on ' + chain + ' and keep the supplied position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return "Provide $" + cap + " of two-sided liquidity to " + n + "'s main pool on " + chain + ' and keep the LP position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + n + ', then use the bridged funds once inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + cap + " of the chain's staking asset through " + n + ' on ' + chain + ' and keep the staking receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + cap + ' of USDC as margin on ' + n + ' and open one small hedged trade, then close it cleanly.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + cap + ' on ' + n + ' and place one small position in an active market you understand.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + cap + ' into one diversified ' + n + ' vault on ' + chain + ' and keep the vault shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + cap + ' of the stable asset through ' + n + ' on ' + chain + ' and hold the minted asset.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + cap + " of the protocol's yield asset on " + chain + ' through ' + n + ' and hold it in the same wallet.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + cap + ' of cover from ' + n + ' on ' + chain + ' for a position you actually hold and keep the policy.';
    return 'Deposit $' + cap + ' of USDC into ' + n + ' on ' + chain + ' and keep the position open in that wallet.';
  }
  function secondFor(p, chain) {
    var c = (p.category || '').toLowerCase(), n = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) return 'Borrow a small amount against the supply on ' + n + ', repay it in full, and repeat once so both sides of the market are used.';
    if (c.indexOf('dex') >= 0) return 'Make two small swaps through ' + n + ' on ' + chain + ' on different days, keeping each swap under 10% of your position.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back through ' + n + ' a week later so the route is used in both directions.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Claim any staking rewards on ' + n + ' once and restake or hold them; do not sell the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Place one limit order and one market order on ' + n + ' in separate weeks so the activity is not a single burst.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('yield') >= 0) return 'Move a small part of the deposit to a second ' + n + ' vault on ' + chain + ' so more than one strategy is used.';
    return 'Use one second feature of ' + n + ' on ' + chain + ', such as a vote, a claim page or a referral-free direct action, once.';
  }
  function stepText(s) { var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; return t.length > 600 ? t.slice(0, 596) + '...' : t; }
  function farmSteps(p) {
    var chain = chainOf(p), cap = capitalFor(p), hold = holdFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm ' + p.name + ' with, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, cap, chain), cost: '$' + cap + ' of capital and about $' + (cap >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: secondFor(p, chain), cost: 'about $2 to $5 of gas', time: '10 minutes' },
      { text: 'Repeat one qualifying action on ' + p.name + ' each week, on a different weekday, instead of doing everything in one day.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the ' + p.name + ' position for at least ' + hold + ' days so the activity appears in more than one weekly snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: 'Open only the points or rewards page that ' + p.name + ' itself publishes, check eligibility there, and never pay a third party to claim.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log every ' + p.name + ' transaction, date and balance in a farm log, set a stop rule for a TVL drop over 30%, and unwind if it triggers.', cost: 'nothing but the log', time: '5 minutes to set up, 2 minutes a week' }
    ].map(stepText);
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
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var k = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (k === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (k === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (k === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (k === 'farm') { av = a.farm_score; bv = b.farm_score; }
      else if (k === 'conf') { av = a.confidence; bv = b.confidence; }
      else if (k === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir; if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }
  function preset(name) {
    state.preset = name;
    if (name === 'farm') { state.sort = 'farm'; state.dir = -1; state.tier = 'all'; state.risk = 'all'; }
    if (name === 'growth') { state.sort = 'growth'; state.dir = -1; }
    if (name === 'safe') { state.sort = 'conf'; state.dir = -1; state.risk = 'Lower'; }
    if (name === 'early') { state.tier = 'early'; state.sort = 'farm'; state.dir = -1; }
    if (name === 'all') { state.sort = 'implied'; state.dir = -1; state.tier = 'all'; state.risk = 'all'; state.category = 'all'; state.chain = 'all'; state.q = ''; state.starredOnly = false; }
    render();
  }

  function header() {
    var px = el('span', { class: 'pixels', 'aria-hidden': 'true' });
    ['p', '', 'p', '', 'p', '', 'p', 'p', 'p'].forEach(function (c) { px.appendChild(el('i', { class: c })); });
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, px, el('span', { class: 'brand-name', html: '' }, 'PIXEL', el('b', null, 'RADAR'))),
      el('div', { class: 'top-meta' }, el('span', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: 'DefiLlama index' }), el('span', { text: DATA.model_version }), el('span', { text: 'No network - data.js only' })));
  }
  function lede() {
    function fact(label, value) { return el('div', { class: 'fact' }, el('span', { text: label }), el('b', null, value)); }
    var total = el('span', null, fmtUsd(DATA.total_implied_usd)); var med = el('span', null, fmtUsd(DATA.median_implied_usd));
    return el('section', { class: 'lede' },
      el('div', { class: 'intro' }, el('h1', { text: 'Token launch radar: ' + DATA.board_size + ' pre-token protocols, ranked by what the market pays their peers' }),
        el('p', { text: 'Implied value is comparables, not a guess: each protocol is priced at the median market-cap / TVL of live tokens in its own category, blended with the global median (' + DATA.global_multiple + 'x), then adjusted for 7-day growth, time running with no token, and multi-chain reach. The watchlist is the floor - the radar adds ' + DATA.early_size + ' early protocols below it. A model claim, never a promise: a protocol records no token, which is not proof it will issue one.' })),
      el('div', { class: 'facts' }, fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size), fact('Board rows', String(DATA.board_size)), fact('Total implied', total), fact('Median implied', med)));
  }
  function selectField(label, id, values, current, onchange) {
    var s = el('select', { id: id, 'aria-label': label }, values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: v[0] === current ? 'selected' : null }); }));
    s.addEventListener('change', function () { onchange(s.value); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search protocols...  ( / )', value: state.q, 'aria-label': 'Search' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTableOnly(); });
    var presets = el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Preset views' }), el('div', { class: 'presets' },
      [['all', 'All'], ['farm', 'Best to farm'], ['growth', 'Fast growth'], ['safe', 'Lower risk'], ['early', 'Early gems']].map(function (p) {
        return el('button', { type: 'button', class: state.preset === p[0] ? 'on' : '', text: p[1], onclick: function () { preset(p[0]); } });
      })));
    var tabs = el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' },
      [['pre', 'Pre-token board'], ['peers', 'Peer evidence'], ['live', 'Live tokens']].map(function (t) {
        return el('button', { type: 'button', class: state.tab === t[0] ? 'on' : '', text: t[1], onclick: function () { state.tab = t[0]; render(); } });
      })));
    var starBtn = el('button', { type: 'button', class: state.starredOnly ? 'on' : '', text: 'My farm list (' + stars.size + ')', onclick: function () { state.starredOnly = !state.starredOnly; render(); } });
    var exp = el('button', { type: 'button', text: 'Export CSV', onclick: exportCsv });
    return el('div', { class: 'controls' },
      el('div', { class: 'rowflex' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        selectField('Category', 'category', [['all', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; writeHash(); render(); }),
        selectField('Chain', 'chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; writeHash(); render(); }),
        selectField('Tier', 'tier', [['all', 'Watchlist + early'], ['watch', 'Watchlist only'], ['early', 'Early only']], state.tier, function (v) { state.tier = v; render(); }),
        selectField('Risk', 'risk', [['all', 'Any risk'], ['Lower', 'Lower'], ['Medium', 'Medium'], ['High', 'High']], state.risk, function (v) { state.risk = v; render(); }),
        tabs),
      el('div', { class: 'rowflex' }, presets, starBtn, exp, el('span', { class: 'count', id: 'count', text: '' })));
  }
  function exportCsv() {
    var lines = ['rank,slug,name,category,tvl_usd,change_7d,implied_value_usd,farm_score,confidence,risk,capital_usd'];
    sorted(rows()).forEach(function (r) { lines.push([r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.implied_value_usd, r.farm_score, r.confidence, r.risk, r.capital_usd].join(',')); });
    var a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'pixel-radar-board.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function sortHead(key, label) { return el('th', { scope: 'col' }, el('button', { type: 'button', text: label + (state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : ''), onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } })); }
  var tableHost = el('div');
  function boardTable() {
    var list = sorted(rows());
    var c = document.getElementById('count'); if (c) c.textContent = list.length + ' rows shown - ' + compare.length + '/3 in compare';
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('h2', { text: 'No protocol matches' }), el('p', { text: 'Clear the search or pick another filter.' }), el('button', { type: 'button', text: 'Reset all', onclick: function () { preset('all'); } })));
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tb = el('tbody');
    list.forEach(function (r) {
      var star = el('button', { type: 'button', class: 'mini' + (stars.has(r.slug) ? ' on' : ''), text: stars.has(r.slug) ? 'FARMING' : '+ FARM', onclick: function (e) { e.stopPropagation(); if (stars.has(r.slug)) stars.delete(r.slug); else stars.add(r.slug); render(); } });
      var cmp = el('button', { type: 'button', class: 'mini' + (compare.indexOf(r.slug) >= 0 ? ' on' : ''), text: 'VS', onclick: function (e) { e.stopPropagation(); toggleCompare(r.slug); } });
      tb.appendChild(el('tr', { class: state.selected === r.slug ? 'sel' : '', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter') openDetail(r.slug); } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' - ' + (r.chains || []).slice(0, 2).join(', ') }))),
        el('td', null, el('span', { class: 'badge' + (r.in_watchlist ? ' w' : ''), text: r.in_watchlist ? 'WATCHLIST' : 'EARLY' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, seg(r.farm_score), el('span', { class: 'num', text: String(r.farm_score) })),
        el('td', { class: 'num', text: r.confidence + '%' }),
        el('td', null, el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round(r.implied_value_usd / max * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
        el('td', null, star, ' ', cmp)));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Ranked by implied value (comparables model). FARM saves a protocol to your farm list, VS adds it to the compare tray (max 3). Select a row for its valuation breakdown and farm plan.' }),
      el('thead', null, el('tr', null, sortHead('implied', '#'), sortHead('name', 'Protocol'), el('th', { text: 'Tier' }), sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('farm', 'Farm score'), sortHead('conf', 'Conf.'), sortHead('implied', 'Implied value'), el('th', { text: 'Actions' }))), tb)));
  }
  function renderTableOnly() { tableHost.textContent = ''; tableHost.appendChild(state.tab === 'pre' ? boardTable() : state.tab === 'peers' ? peersView() : liveView()); }
  function peersView() {
    return el('div', { class: 'panel' }, el('div', { class: 'peergrid' }, DATA.categories.map(function (c) {
      return el('div', { class: 'peer' }, el('b', { text: c.category }), el('span', { text: c.peers + ' live peers - median ' + c.median_multiple + 'x TVL' }), el('div', null, seg(Math.round(c.median_multiple * 60))));
    })), el('p', { class: 'sub', text: 'Peer evidence: every multiple above is read from live-token protocols in the same snapshot. Categories with fewer than 3 peers fall back to the global median ' + DATA.global_multiple + 'x.' }));
  }
  function liveView() {
    var tb = el('tbody');
    DATA.live.forEach(function (r) { tb.appendChild(el('tr', null, el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' - ' + (r.chains || []).slice(0, 2).join(', ') }))), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio + 'x' }), el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }), el('td', null, el('span', { class: 'badge', text: 'ALREADY TRADES' })))); });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null, el('caption', { text: 'Live tokens are evidence, not entries: their market caps set the peer multiples, and they are never mixed into the pre-token ranking.' }), el('thead', null, el('tr', null, el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap/TVL' }), el('th', { text: '7d' }), el('th', { text: 'Token' }))), tb)));
  }
  function modelPanel() {
    var m = DATA.model;
    var gw = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(state.gw * 100)), 'aria-label': 'Growth weight' });
    var pw = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(state.pw * 100)), 'aria-label': 'Peer weight' });
    var out = el('div', { class: 'out', id: 'labout' });
    function upd() {
      state.gw = Number(gw.value) / 100; state.pw = Number(pw.value) / 100;
      var ranked = DATA.rows.map(function (r) { return { r: r, v: labImplied(r) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
      out.textContent = '';
      out.appendChild(el('b', { text: 'Lab top 5 (growth ' + state.gw.toFixed(2) + ' - peer ' + state.pw.toFixed(2) + '): ' }));
      out.appendChild(document.createTextNode(ranked.map(function (x, i) { return (i + 1) + '. ' + x.r.name + ' ' + fmtUsd(x.v) + ' (official #' + x.r.rank + ')'; }).join(' - ')));
    }
    gw.addEventListener('input', upd); pw.addEventListener('input', upd);
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed - and the Model Lab' }),
      el('div', { class: 'formula', text: 'implied = round( TVL x effective x growth x maturity x chain ) - effective = clamp( 0.65 x category peer median + 0.35 x global median ' + DATA.global_multiple + 'x, ' + m.multiple_floor + ', ' + m.multiple_cap + ' ) - growth = 1 + clamp(change_7d,' + m.growth_floor + ',' + m.growth_cap + ')/100 x ' + m.growth_weight + ' - maturity = ' + m.maturity_floor + ' + min(age,' + m.maturity_days + ')/' + m.maturity_days + ' x ' + m.maturity_range + ' - chain = 1 + min(chains-1,4) x ' + m.chain_step }),
      el('p', { text: 'Farm score (0-100) blends log implied value, momentum, confidence and capital efficiency; it never changes the rank, it only helps a reader sort by worth-my-time. Risk rises when a protocol is young, small, or its TVL is falling fast. Move the Lab sliders to re-rank all ' + DATA.board_size + ' rows under your own weights - the official board never changes.' }),
      el('div', { class: 'lab' }, el('div', null, el('span', { class: 'sub', text: 'Growth weight' }), gw), el('div', null, el('span', { class: 'sub', text: 'Category-peer weight' }), pw), out));
    setTimeout(upd, 0);
    return panel;
  }
  function toggleCompare(slug) { var i = compare.indexOf(slug); if (i >= 0) compare.splice(i, 1); else { if (compare.length >= 3) compare.shift(); compare.push(slug); } render(); }
  var dialog = el('dialog', { class: 'detail', id: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
  function eqRow(label, value, tot) { return el('div', null, el('span', { text: label }), el('b', { class: 'num' + (tot ? ' tot' : ''), text: value })); }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0]; if (!row) return;
    state.selected = slug; writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row); var key = row.slug; if (!done[key]) done[key] = steps.map(function () { return false; });
    dialog.appendChild(el('div', { class: 'detail-head' }, el('div', null, el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' - ' + (row.in_watchlist ? 'WATCHLIST' : 'EARLY') + ' - risk ' + row.risk }), el('h2', { text: row.name }), el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains || []).join(', ') })), el('button', { type: 'button', text: 'Close X', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'Valuation breakdown - comparables' }),
      el('div', { class: 'eq' },
        eqRow('TVL', fmtUsd(row.tvl_usd)), eqRow(row.peer_count > 0 ? 'Category peer median (' + row.peer_count + ' live peers)' : 'Category peers (none live - global fallback)', row.peer_multiple + 'x'),
        eqRow('Global peer median', DATA.global_multiple + 'x'), eqRow('Effective multiple', row.effective_multiple + 'x'),
        eqRow('7d growth / multiplier', fmtPct(row.change_7d) + ' / ' + row.growth_multiplier + 'x'),
        eqRow('Age with no token / maturity', fmtAge(row.age_days) + ' / ' + row.maturity_multiplier + 'x'),
        eqRow('Chains / chain multiplier', String((row.chains || []).length) + ' / ' + row.chain_multiplier + 'x'),
        eqRow('Confidence / Farm score', row.confidence + '% / ' + row.farm_score), eqRow('Capital to farm / hold', '$' + row.capital_usd + ' / ' + row.hold_days + 'd'),
        eqRow('Implied value', fmtUsd(row.implied_value_usd), true)),
      el('p', { class: 'sub', text: 'Page check: recomputed from these multipliers = ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ' - matches board.json exactly.' : ' - differs, data is stale.') + ' Estimate only: this protocol records no token; that is not a promise one will launch.' })));
    var prog = el('div', { class: 'progress' }, el('i', { style: 'width:0%' }));
    var list = el('ol', { class: 'steps' });
    function refreshProg() { var n = done[key].filter(Boolean).length; prog.firstChild.style.width = Math.round(n / steps.length * 100) + '%'; }
    steps.forEach(function (s, i) {
      var at = s.indexOf(' Cost: '); var action = at >= 0 ? s.slice(0, at) : s; var tail = at >= 0 ? s.slice(at + 1) : '';
      var box = el('input', { type: 'checkbox', checked: done[key][i] ? 'checked' : null });
      box.addEventListener('change', function () { done[key][i] = box.checked; refreshProg(); });
      list.appendChild(el('li', null, el('label', null, box, el('span', { text: action })), el('span', { class: 'cost', text: tail })));
    });
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'Farm plan - check steps off as you do them' }), prog, list,
      el('div', { class: 'rowflex' },
        el('button', { type: 'button', text: 'Copy farm plan', onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(row.name + ' farm plan\n' + steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n')); } }),
        el('button', { type: 'button', text: stars.has(row.slug) ? 'Farming - saved' : 'Add to farm list', onclick: function () { stars.add(row.slug); render(); openDetail(row.slug); } }),
        el('button', { type: 'button', text: 'Add to compare', onclick: function () { toggleCompare(row.slug); } }))));
    refreshProg();
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }
  function openCompare() {
    if (compare.length < 2) return;
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' }, el('h2', { text: 'Compare' }), el('button', { type: 'button', text: 'Close X', onclick: function () { dialog.close(); } })));
    var rowsDef = [['Implied', function (r) { return fmtUsd(r.implied_value_usd); }], ['TVL', function (r) { return fmtUsd(r.tvl_usd); }], ['7d', function (r) { return fmtPct(r.change_7d); }], ['Farm score', function (r) { return String(r.farm_score); }], ['Confidence', function (r) { return r.confidence + '%'; }], ['Risk', function (r) { return r.risk; }], ['Peer multiple', function (r) { return r.peer_multiple + 'x (' + r.peer_count + ' peers)'; }], ['Capital / hold', function (r) { return '$' + r.capital_usd + ' / ' + r.hold_days + 'd'; }], ['Age', function (r) { return fmtAge(r.age_days); }]];
    var tb = el('tbody');
    rowsDef.forEach(function (d) { var tr = el('tr', null, el('td', { class: 'sub', text: d[0] })); compare.forEach(function (s) { var r = DATA.rows.filter(function (x) { return x.slug === s; })[0]; tr.appendChild(el('td', { class: 'num', text: d[1](r) })); }); tb.appendChild(tr); });
    var head = el('tr', null, el('th', { text: '' })); compare.forEach(function (s) { var r = DATA.rows.filter(function (x) { return x.slug === s; })[0]; head.appendChild(el('th', { text: '#' + r.rank + ' ' + r.name })); });
    dialog.appendChild(el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, head), tb)));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header()); shell.appendChild(lede()); shell.appendChild(controls());
    tableHost.textContent = ''; tableHost.appendChild(state.tab === 'pre' ? boardTable() : state.tab === 'peers' ? peersView() : liveView());
    shell.appendChild(tableHost);
    if (state.tab === 'pre') shell.appendChild(modelPanel());
    if (compare.length) shell.appendChild(el('div', { class: 'comparebar' }, el('span', { text: 'Compare tray: ' + compare.map(function (s) { var r = DATA.rows.filter(function (x) { return x.slug === s; })[0]; return r ? r.name : s; }).join(' vs ') }), el('button', { type: 'button', text: 'Compare now', onclick: openCompare }), el('button', { type: 'button', text: 'Clear', onclick: function () { compare = []; render(); } })));
    shell.appendChild(el('p', { class: 'foot', text: 'PIXEL RADAR - ' + DATA.model_version + ' - snapshot ' + DATA.as_of + ' - implied values are model claims, not prices or promises.' }));
    app.appendChild(shell);
    if (!dialog.isConnected) app.appendChild(dialog);
    app.setAttribute('aria-busy', 'false');
    window.__shotReady = true;
    if (state.selected) openDetail(state.selected);
  }
  readHash(); render();
  document.addEventListener('keydown', function (e) { if (e.key === '/' && document.activeElement && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); var q = document.getElementById('q'); if (q) q.focus(); } if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
