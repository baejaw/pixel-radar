// PIXEL RADAR dashboard (radar-3). Reads window.RADAR (written beside dashboard/
// by main.ts) and renders: a fitted-model board of every launch candidate in the
// snapshot, filters and presets, a per-protocol detail drawer with the full
// fitted breakdown and a checkable farm plan, a peer-evidence view, a live-token
// view, a Model check view with the held-out validation, a compare tray, a farm
// list, a CSV export and a Model Lab that re-ranks the board live.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', risk: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, starredOnly: false, preset: 'all', fw: 1, gt: 1 };
  var stars = new Set(); var compare = []; var done = {};

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B'; if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M'; if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K'; return usd.format(n); }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return '?'; return d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  // The page recomputes a row's implied value from the published fit_log, the
  // exact rounded figure board.json was priced from: the detail view's number
  // is the board's number, not a second estimate.
  function impliedOf(r) { return Math.max(1, Math.round(Math.exp(r.fit_log))); }
  function labImplied(r) {
    var fitLog = r.fit_log + (state.gt - 1) * r.growth_part;
    return Math.max(1, Math.round(Math.exp(state.fw * fitLog + (1 - state.fw) * r.peer_log)));
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

  // Farm plan: the same derivation lib/model.ts writes into board.json -
  // category, first chain (and its gas tier), TVL tier and age decide every
  // action, cost and hold. No name is special-cased.
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
    var high = chain === 'Ethereum' || chain === 'Bitcoin';
    var g1 = high ? 3 : 1, g2 = high ? 8 : 2, g3 = high ? 5 : 2, g4 = high ? 4 : 1;
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm ' + p.name + ' with, and keep its seed phrase offline.', cost: 'about $' + g1 + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, cap, chain), cost: '$' + cap + ' of capital and about $' + g2 + ' of gas on ' + chain, time: '15 minutes to set up' },
      { text: secondFor(p, chain), cost: 'about $' + g3 + ' of gas on ' + chain, time: '10 minutes' },
      { text: 'Repeat one qualifying action on ' + p.name + ' each week, on a different weekday, instead of doing everything in one day.', cost: 'about $' + g4 + ' of gas a week on ' + chain, time: '10 minutes a week' },
      { text: 'Hold the ' + p.name + ' position for at least ' + hold + ' days so the activity appears in more than one weekly snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' },
      { text: 'Open only the points or rewards page that ' + p.name + ' itself publishes, check eligibility there, and never pay a third party to claim.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log every ' + p.name + ' transaction, date and balance in a farm log, set a stop rule for a TVL drop over 30%, and unwind if it triggers.', cost: 'nothing but the log', time: '5 minutes to set up, 2 minutes a week' },
      { text: 'Plan total for ' + p.name + ': $' + cap + ' of working capital, about $' + (g1 + g2 + g3) + ' of gas to set up on ' + chain + ' plus about $' + g4 + ' of gas a week to maintain, about 45 minutes of setup and 10 minutes a week, held at least ' + hold + ' days.', cost: 'no extra cost - this line is the total of the steps above', time: '2 minutes to read' }
    ];
    return steps.map(stepText);
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
      else if (k === 'odds') { av = a.odds; bv = b.odds; }
      else if (k === 'ev') { av = a.opportunity_usd; bv = b.opportunity_usd; }
      else if (k === 'age') { av = a.age_days === null ? 1e9 : a.age_days; bv = b.age_days === null ? 1e9 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir; if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }
  function preset(name) {
    state.preset = name;
    if (name === 'farm') { state.sort = 'farm'; state.dir = -1; state.tier = 'all'; state.risk = 'all'; }
    if (name === 'ev') { state.sort = 'ev'; state.dir = -1; state.tier = 'all'; state.risk = 'all'; }
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
      el('div', { class: 'brand' }, px, el('span', { class: 'brand-name' }, 'PIXEL', el('b', null, 'RADAR'))),
      el('div', { class: 'top-meta' }, el('span', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: 'DefiLlama index' }), el('span', { text: DATA.model_version }), el('span', { text: 'No network - data.js only' })));
  }
  function lede() {
    function fact(label, value) { return el('div', { class: 'fact' }, el('span', { text: label }), el('b', null, value)); }
    var v = DATA.validation;
    return el('section', { class: 'lede' },
      el('div', { class: 'intro' }, el('h1', { text: 'Token launch radar: ' + DATA.board_size + ' pre-token protocols, priced by a model fitted on the snapshot itself' }),
        el('p', { text: 'No hand-set multiples: a ridge regression of log market cap on log TVL, 7-day growth, age, category and chain offsets was fitted on the ' + DATA.fit.fit_rows + ' protocols in this snapshot whose token already trades, then tested on held-out protocols it never saw - median error ' + v.fitted.median_ape_pct + '% against ' + v.baseline.median_ape_pct + '% for a peer-median model (Model check view has the full test). The board ranks every launch candidate at every TVL: all ' + DATA.watchlist_size + ' watchlist protocols plus ' + DATA.early_size + ' more, with ' + DATA.excluded_passthrough + ' pass-through products and ' + DATA.excluded_cex + ' exchanges set aside, not ranked as launches. Launch odds come from the snapshot\'s own base rates. A model claim, never a promise: a protocol records no token, which is not proof it will issue one.' })),
      el('div', { class: 'facts' }, fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size), fact('Board rows', String(DATA.board_size)), fact('Fitted on', DATA.fit.fit_rows + ' live tokens'), fact('Held-out median error', v.fitted.median_ape_pct + '%')));
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
      [['all', 'All'], ['ev', 'Top opportunity'], ['farm', 'Best to farm'], ['growth', 'Fast growth'], ['safe', 'Lower risk'], ['early', 'Early gems']].map(function (p) {
        return el('button', { type: 'button', class: state.preset === p[0] ? 'on' : '', text: p[1], onclick: function () { preset(p[0]); } });
      })));
    var tabs = el('div', { class: 'field' }, el('span', { class: 'lab', text: 'View' }), el('div', { class: 'tabs' },
      [['pre', 'Pre-token board'], ['peers', 'Peer evidence'], ['live', 'Live tokens'], ['model', 'Model check']].map(function (t) {
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
    var lines = ['rank,slug,name,category,tvl_usd,change_7d,implied_value_usd,odds,opportunity_usd,farm_score,confidence,risk,capital_usd'];
    sorted(rows()).forEach(function (r) { lines.push([r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', r.tvl_usd, r.change_7d === null ? '' : r.change_7d, r.implied_value_usd, r.odds, r.opportunity_usd, r.farm_score, r.confidence, r.risk, r.capital_usd].join(',')); });
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
        el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' - ' + (r.chains || []).slice(0, 2).join(', ') + (r.pass_through ? ' - PASS-THROUGH' : '') }))),
        el('td', null, el('span', { class: 'badge' + (r.in_watchlist ? ' w' : ''), text: r.in_watchlist ? 'WATCHLIST' : 'EARLY' })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', null, seg(r.farm_score), el('span', { class: 'num', text: String(r.farm_score) })),
        el('td', { class: 'num', text: r.confidence + '%' }),
        el('td', null, seg(r.odds, true), el('span', { class: 'num', text: r.odds + '%' })),
        el('td', { class: 'num', text: fmtUsd(r.opportunity_usd) }),
        el('td', null, el('span', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(4, Math.round(r.implied_value_usd / max * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })),
        el('td', null, star, ' ', cmp)));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { text: 'Ranked by implied value (fitted model). Odds = launch odds from category base rates; EV index = implied x odds x confidence. FARM saves a protocol to your farm list, VS adds it to the compare tray (max 3). Select a row for its fitted breakdown and farm plan.' }),
      el('thead', null, el('tr', null, sortHead('implied', '#'), sortHead('name', 'Protocol'), el('th', { text: 'Tier' }), sortHead('tvl', 'TVL'), sortHead('growth', '7d'), sortHead('farm', 'Farm score'), sortHead('conf', 'Conf.'), sortHead('odds', 'Odds'), sortHead('ev', 'EV index'), sortHead('implied', 'Implied value'), el('th', { text: 'Actions' }))), tb)));
  }
  function currentView() { return state.tab === 'pre' ? boardTable() : state.tab === 'peers' ? peersView() : state.tab === 'live' ? liveView() : modelView(); }
  function renderTableOnly() { tableHost.textContent = ''; tableHost.appendChild(currentView()); }
  function peersView() {
    return el('div', { class: 'panel' }, el('div', { class: 'peergrid' }, DATA.categories.map(function (c) {
      return el('div', { class: 'peer' }, el('b', { text: c.category }), el('span', { text: c.peers + ' live peers - median ' + c.peer_multiple + 'x TVL - fit offset ' + (c.offset >= 0 ? '+' : '') + c.offset }), el('span', { text: 'Launch base rate ' + c.base_rate_pct + '% - ' + c.live_count + ' trading / ' + c.board_count + ' waiting' }), el('div', null, seg(Math.round(c.peer_multiple * 60))));
    })), el('p', { class: 'sub pad', text: 'Peer evidence: every multiple and offset above is read from live-token protocols in the same snapshot. The fitted model uses the offsets; the medians are the baseline model\'s evidence, kept for comparison in the Model Lab.' }));
  }
  function liveView() {
    var tb = el('tbody');
    DATA.live.forEach(function (r) { tb.appendChild(el('tr', null, el('td', null, el('span', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' - ' + (r.chains || []).slice(0, 2).join(', ') }))), el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }), el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }), el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio + 'x' }), el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }), el('td', null, el('span', { class: 'badge', text: 'ALREADY TRADES' })))); });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null, el('caption', { text: 'Live tokens are evidence, not entries: the model is fitted on them, and they are never mixed into the pre-token ranking.' }), el('thead', null, el('tr', null, el('th', { text: 'Protocol' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap/TVL' }), el('th', { text: '7d' }), el('th', { text: 'Token' }))), tb)));
  }
  function statRow(label, s, chosen) {
    return el('tr', chosen ? { class: 'sel' } : null, el('td', { text: label + (chosen ? ' - SHIPPED' : '') }), el('td', { class: 'num', text: s.median_ape_pct + '%' }), el('td', { class: 'num', text: s.mean_ape_pct + '%' }), el('td', { class: 'num', text: String(s.r2_log) }));
  }
  function modelView() {
    var f = DATA.fit, v = DATA.validation;
    var coef = el('tbody');
    [['Intercept (at mean log TVL)', f.intercept], ['Log TVL (elasticity)', f.log_tvl], ['7-day growth, per +100%', f.growth], ['Log age, per log day', f.log_age]].forEach(function (r) {
      coef.appendChild(el('tr', null, el('td', { text: r[0] }), el('td', { class: 'num', text: String(r[1]) })));
    });
    var catTb = el('tbody');
    DATA.categories.slice(0, 16).forEach(function (c) { catTb.appendChild(el('tr', null, el('td', { text: c.category }), el('td', { class: 'num', text: String(c.peers) }), el('td', { class: 'num', text: (c.offset >= 0 ? '+' : '') + c.offset }), el('td', { class: 'num', text: c.peer_multiple + 'x' }), el('td', { class: 'num', text: c.base_rate_pct + '%' }))); });
    var chTb = el('tbody');
    DATA.chain_offsets.slice().sort(function (a, b) { return b.peers - a.peers; }).slice(0, 10).forEach(function (c) { chTb.appendChild(el('tr', null, el('td', { text: c.chain }), el('td', { class: 'num', text: String(c.peers) }), el('td', { class: 'num', text: (c.offset >= 0 ? '+' : '') + c.offset }))); });
    return el('div', null,
      el('section', { class: 'panel model' }, el('h2', { text: 'Model check - held-out validation' }),
        el('p', { text: 'The fit set is the ' + f.candidate_rows + ' protocols whose token trades with a recorded market cap and real TVL (exchanges excluded). A fixed outlier rule drops any whose market-cap / TVL multiple falls outside [' + f.mult_band[0] + ', ' + f.mult_band[1] + '] - a mismatched record, not a valuation - leaving ' + f.fit_rows + ' fitted rows (' + f.dropped_rows + ' dropped). Validation is deterministic 2-fold cross-fitting: each half of the fitted rows is priced by a model trained only on the other half, so every error below is on a protocol the model never saw.' }),
        el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Model' }), el('th', { text: 'Median error' }), el('th', { text: 'Mean error' }), el('th', { text: 'R2 (log)' }))), el('tbody', null, statRow('Fitted regression (radar-3)', v.fitted, true), statRow('Peer-median baseline (radar-2)', v.baseline, false), statRow('50/50 log blend of the two', v.blend, false)))),
        el('p', { text: 'The fitted model has the lowest held-out median error and the highest R2, so the board ships it alone; the blend only wins on mean error, which a few wild multiples dominate, and it stays available in the Model Lab. Errors near 77% at the median are the honest state of pricing pre-token protocols from TVL: read implied values as orders of magnitude, and the confidence score says how much evidence stands behind each one.' })),
      el('section', { class: 'panel model' }, el('h2', { text: 'Fitted coefficients' }),
        el('div', { class: 'formula', text: 'log(implied) = ' + f.intercept + ' + ' + f.log_tvl + ' x (log TVL - ' + f.mean_log_tvl + ') + ' + f.growth + ' x clip(change_7d, -60, 120)/100 + ' + f.log_age + ' x log1p(age) + category offset + chain offset - ridge penalties 3 (category) and 6 (chain) shrink each offset toward zero by about n/(n + penalty)' }),
        el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Term' }), el('th', { text: 'Coefficient' }))), coef)),
        el('p', { text: 'Read: market cap scales at TVL^' + f.log_tvl + ' - doubling TVL multiplies expected cap by about ' + Math.pow(2, f.log_tvl).toFixed(2) + 'x, not 2x. A +100% week adds ' + f.growth + ' to the log price. Age\'s coefficient is near zero: time running with no token, on its own, neither earns nor costs value once size and category are counted - the data said so, not the author.' })),
      el('section', { class: 'panel model' }, el('h2', { text: 'Category offsets and launch base rates' }),
        el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { text: 'Fit peers' }), el('th', { text: 'Fit offset' }), el('th', { text: 'Peer median' }), el('th', { text: 'Base rate' }))), catTb)),
        el('p', { text: 'Launch odds start from the base rate: of the protocols in a category, the share whose token already trades (shrunk toward the global ' + DATA.global_base_rate_pct + '%), then adjusted by TVL tier, 7-day growth, age, and a 0.35 factor for pass-through products. Odds never move the implied value or the rank; the EV index (implied x odds x confidence) is the reader\'s sort, one click away in the presets.' })),
      el('section', { class: 'panel model' }, el('h2', { text: 'Chain offsets (primary chain, top 10 by fit peers)' }),
        el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Chain' }), el('th', { text: 'Fit peers' }), el('th', { text: 'Fit offset' }))), chTb))));
  }
  function modelPanel() {
    var fw = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(state.fw * 100)), 'aria-label': 'Fitted model weight' });
    var gt = el('input', { type: 'range', min: '0', max: '200', value: String(Math.round(state.gt * 100)), 'aria-label': 'Growth tilt' });
    var out = el('div', { class: 'out', id: 'labout' });
    function upd() {
      state.fw = Number(fw.value) / 100; state.gt = Number(gt.value) / 100;
      var ranked = DATA.rows.map(function (r) { return { r: r, v: labImplied(r) }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
      out.textContent = '';
      out.appendChild(el('b', { text: 'Lab top 5 (fitted ' + state.fw.toFixed(2) + ' - growth tilt ' + state.gt.toFixed(2) + '): ' }));
      out.appendChild(document.createTextNode(ranked.map(function (x, i) { return (i + 1) + '. ' + x.r.name + ' ' + fmtUsd(x.v) + ' (official #' + x.r.rank + ')'; }).join(' - ')));
    }
    fw.addEventListener('input', upd); gt.addEventListener('input', upd);
    var panel = el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed - and the Model Lab' }),
      el('div', { class: 'formula', text: 'implied = round( exp( fit_log ) ) - fit_log is the fitted regression of the Model check view, priced from its published rounded coefficients, so this page recomputes board.json exactly. The Lab blends the fitted log price with the peer-median baseline (weight slider) and scales the fitted growth term (tilt slider): at the defaults (1.00 / 1.00) the Lab is the official board.' }),
      el('p', { text: 'Farm score (0-100) blends log implied value, momentum, confidence and capital efficiency; launch odds come from category base rates; neither changes the rank, they only help a reader sort. Move the Lab sliders to re-rank all ' + DATA.board_size + ' rows under your own weights - the official board never changes.' }),
      el('div', { class: 'lab' }, el('div', null, el('span', { class: 'sub', text: 'Fitted-model weight' }), fw), el('div', null, el('span', { class: 'sub', text: 'Growth tilt' }), gt), out));
    setTimeout(upd, 0);
    return panel;
  }
  function toggleCompare(slug) { var i = compare.indexOf(slug); if (i >= 0) compare.splice(i, 1); else { if (compare.length >= 3) compare.shift(); compare.push(slug); } render(); }
  var dialog = el('dialog', { class: 'detail', id: 'detail' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });
  function eqRow(label, value, tot) { return el('div', null, el('span', { text: label }), el('b', { class: 'num' + (tot ? ' tot' : ''), text: value })); }
  function catInfo(name) { var c = DATA.categories.filter(function (x) { return x.category === name; })[0]; return c || null; }
  function chainOffset(name) { var c = DATA.chain_offsets.filter(function (x) { return x.chain === name; })[0]; return c ? c.offset : 0; }
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0]; if (!row) return;
    state.selected = slug; writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row); var key = row.slug; if (!done[key]) done[key] = steps.map(function () { return false; });
    var ci = catInfo(row.category || 'Other');
    var ageTerm = DATA.fit.log_age * Math.log1p(row.age_days === null ? DATA.fit.median_age_days : row.age_days);
    dialog.appendChild(el('div', { class: 'detail-head' }, el('div', null, el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' - ' + (row.in_watchlist ? 'WATCHLIST' : 'EARLY') + ' - risk ' + row.risk + (row.pass_through ? ' - PASS-THROUGH' : '') }), el('h2', { text: row.name }), el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains || []).join(', ') })), el('button', { type: 'button', text: 'Close X', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' }, el('h3', { text: 'Valuation breakdown - fitted model' }),
      el('div', { class: 'eq' },
        eqRow('TVL', fmtUsd(row.tvl_usd)),
        eqRow('Fitted multiple (implied / TVL)', row.fitted_multiple + 'x'),
        eqRow('Category offset (' + (row.category || 'Other') + ', ' + row.peer_count + ' fit peers)', ci ? String(ci.offset) : '0 (no fit peers)'),
        eqRow('Primary chain offset (' + chainOf(row) + ')', String(chainOffset(chainOf(row)))),
        eqRow('7d growth term', (row.growth_part >= 0 ? '+' : '') + row.growth_part + ' log'),
        eqRow('Age with no token / age term', fmtAge(row.age_days) + ' / ' + ageTerm.toFixed(4) + ' log'),
        eqRow('Peer-median baseline multiple', row.peer_multiple + 'x'),
        eqRow('Launch odds (category base ' + row.base_rate_pct + '%)', row.odds + '%'),
        eqRow('EV index (implied x odds x confidence)', fmtUsd(row.opportunity_usd)),
        eqRow('Confidence / Farm score', row.confidence + '% / ' + row.farm_score), eqRow('Capital to farm / hold', '$' + row.capital_usd + ' / ' + row.hold_days + 'd'),
        eqRow('Implied value', fmtUsd(row.implied_value_usd), true)),
      el('p', { class: 'sub', text: 'Page check: recomputed from the published fit = ' + fmtUsd(impliedOf(row)) + (impliedOf(row) === row.implied_value_usd ? ' - matches board.json exactly.' : ' - differs, data is stale.') + ' Estimate only: this protocol records no token; that is not a promise one will launch.' })));
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
    var rowsDef = [['Implied', function (r) { return fmtUsd(r.implied_value_usd); }], ['TVL', function (r) { return fmtUsd(r.tvl_usd); }], ['7d', function (r) { return fmtPct(r.change_7d); }], ['Odds', function (r) { return r.odds + '%'; }], ['EV index', function (r) { return fmtUsd(r.opportunity_usd); }], ['Farm score', function (r) { return String(r.farm_score); }], ['Confidence', function (r) { return r.confidence + '%'; }], ['Risk', function (r) { return r.risk; }], ['Fitted multiple', function (r) { return r.fitted_multiple + 'x'; }], ['Capital / hold', function (r) { return '$' + r.capital_usd + ' / ' + r.hold_days + 'd'; }], ['Age', function (r) { return fmtAge(r.age_days); }]];
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
    tableHost.textContent = ''; tableHost.appendChild(currentView());
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
