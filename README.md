# pixel-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/baejaw/pixel-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/baejaw/pixel-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

PIXEL RADAR — a token launch radar in a black-and-white pixel theme with a single purple accent. It ranks 226 pre-token protocols by implied value using a comparables model: each protocol is priced at the median market-cap / TVL of live tokens in its own category (blended with the global median), then adjusted for 7-day TVL growth, time running with no token, and multi-chain reach. The dashboard is built for farming decisions: search, category / chain / tier / risk filters, preset views (Best to farm, Fast growth, Lower risk, Early gems), a Farm Score and confidence per row, a per-protocol detail drawer with the full valuation breakdown and a checkable 7-step farm plan with costs and times, peer-evidence and live-token views, a 3-way compare tray, a personal farm list, CSV export, and a Model Lab that re-ranks the whole board live under your own growth and peer weights.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Then open `out/dashboard/index.html` in a browser. The dashboard is plain static files — no build step, no network requests; all its data is in the generated `data.js`.

## Layout

- `main.ts` — the hand-in program (Node 22, standard library only): writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, writes `dossier.json`
- `lib/model.ts` — the comparables model (`radar-2`): peer multiples, implied value, confidence, farm score, risk and the farm-plan derivation
- `dashboard/` — the pixel dashboard (index.html, app.css, app.js)
- `screenshots/` — the board, a protocol detail view, and a filtered (Dexs) view
- `vendor/makefun-board.ts` — the vendored make.fun dossier library

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
