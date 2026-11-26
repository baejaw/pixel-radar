# pixel-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/baejaw/pixel-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/baejaw/pixel-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

PIXEL RADAR — a token launch radar in a black-and-white pixel theme with a single purple accent. Version 2 replaces the hand-set comparables of v1 with a model that is **fitted on the snapshot itself and tested on protocols it never saw**.

## The model (radar-3 fitted)

The snapshot holds 144 protocols whose token already trades. Of those, 119 are fit candidates (recorded market cap above zero, real TVL, not an exchange). A fixed outlier rule drops any candidate whose market-cap / TVL multiple falls outside **[0.005, 6]** — a mismatched record (a token's cap set against one deployment's TVL, or the reverse), not a valuation — leaving **108 fitted rows** (11 dropped).

On those 108, a ridge regression is fitted by normal equations:

```
log(mcap) ~ intercept + 0.5746 x (log TVL - mean log TVL)
          + 1.2092 x clip(change_7d, -60, 120)/100
          - 0.0560 x log1p(age in days, median-imputed when unlisted)
          + category offset + primary-chain offset
```

Ridge penalties (3 on category offsets, 6 on chain offsets) shrink each offset toward the global fit by roughly n/(n + penalty), so a category with two live tokens barely moves the price and one with twenty moves it properly. Read the TVL term: market cap scales at TVL^0.57 — doubling TVL multiplies the expected cap by about 1.49x, not 2x. Age's coefficient is near zero: time running with no token, on its own, neither earns nor costs value once size and category are counted. The data said so, not the author.

### Held-out validation (deterministic 2-fold cross-fitting, fold = FNV-1a(slug) mod 2)

Every fitted row is priced by a model trained only on the other half, and the v1 peer-median model and a 50/50 log blend are scored on identical folds with identical evidence:

| Model | Median error | Mean error | R² (log) |
|---|---|---|---|
| **Fitted regression (shipped)** | **76.5%** | 325.2% | **0.352** |
| Peer-median baseline (v1 radar-2) | 88.5% | 335.8% | 0.155 |
| 50/50 log blend | 82.9% | **302.9%** | 0.305 |

The fitted model wins the median error and the R², so the board ships it alone; the blend wins only mean error (a few wild multiples dominate that metric) and survives as a Model Lab slider. A 5-fold variant of the same cross-fitting, run while developing, agreed (fitted median error 79.6%, R² 0.300, best of the three). Errors near 77% at the median are the honest state of pricing pre-token protocols from TVL: implied values are orders of magnitude, and each row's confidence score says how much evidence stands behind it. Every published coefficient and offset is rounded before it prices anything, and the board is priced from the rounded parameters, so the dashboard recomputes board.json's exact implied values.

### Coverage

Of the snapshot's 758 protocols: 144 already trade (the fit evidence, shown in the Live tokens view), 272 carry a parent protocol's token symbol with no cap of their own, and 342 record no token. Applying the watchlist's own hygiene at every TVL — setting aside 42 exchanges, 87 pass-through products (bridges and wrapped/staked products, whose value accrues to a token that already trades) and 11 versioned re-deployments — leaves **202 launch candidates, all ranked**: every one of the 40 watchlist protocols plus 162 more, from $2.8B of TVL down to $5M. The set-asides are counted in the open on the dashboard, not dropped quietly; five ranked rows are still flagged pass-through by name and carry discounted odds.

### Launch odds and the EV index

Odds start from the snapshot's own base rate: of the protocols in a category, the share whose token already trades (global 41.6%, shrunk toward it per category), adjusted by TVL tier, 7-day growth, age, and a 0.35 factor for pass-through products. Odds never move the implied value or the rank. The **EV index** — implied × odds × confidence — is the reader's expected-value sort, one click away in the presets.

### Farm plans

Every row carries an 8-step plan derived from its category, primary chain, TVL tier and age: a category action and a second-feature action, weekly repetition, a hold period, an eligibility check and a stop rule, each step with a dollar cost (gas priced by chain tier — Ethereum and Bitcoin cost more) and a time, and a closing **totals line**: working capital, setup gas, weekly gas, setup minutes and hold days for that protocol.

## The dashboard

Search, category / chain / tier / risk filters, preset views (All, **Top opportunity**, Best to farm, Fast growth, Lower risk, Early gems), sortable columns including Odds and EV index, a per-protocol detail drawer with the full fitted breakdown (offsets, growth and age terms, baseline multiple, odds, EV index, and a page check that recomputes the board's number) and a checkable 8-step farm plan with copy, peer-evidence and live-token views, a **Model check view** with the held-out validation table, the fitted coefficients and the category/chain offset tables, a 3-way compare tray, a personal farm list, CSV export, and a Model Lab that re-ranks the whole board live under your own fitted/baseline blend and growth tilt.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. The dashboard is plain static files — no build step, no network requests; all its data is in the generated `data.js`. Two runs write byte-identical output.

## Layout

- `main.ts` — the hand-in program (Node 22, standard library only): writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`
- `lib/model.ts` — the radar-3 model: the ridge fit and its cross-fitting validation, launch odds, confidence, farm score, risk and the farm-plan derivation
- `dashboard/` — the pixel dashboard (index.html, app.css, app.js)
- `screenshots/` — the board, a protocol detail view, a filtered (Dexs) view, and the Model check view
- `vendor/makefun-board.ts` — the vendored make.fun dossier library

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
