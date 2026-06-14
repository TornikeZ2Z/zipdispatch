# ZIP TO ZIP MOVING — BUILD HANDOFF / NEW-CHAT PRIMER
Paste this whole file as the FIRST message in a fresh chat. Ideally start that chat INSIDE the same Project so it shares project memory.

## STEP 0 — make the new chat fully capable (do this first)
The real source files live in this repo under `src/`. In the new chat, run this one bash command to pull everything into the sandbox:

```
mkdir -p /home/claude/dispatch && cd /home/claude/dispatch && for f in engine_core.js cleanup_logic.js cleanup_ui.html cleanup_extra.css disp_style.css template2.html data_all.json zipdb.json; do curl -sL "https://raw.githubusercontent.com/TornikeZ2Z/zipdispatch/main/src/$f" -o "$f"; done && ls -la
```

After that, the chat has the real engine + cleanup logic + UI and can edit, validate (node), and redeploy. Do NOT rebuild from prose — pull the files.

## WHO / WHAT
Owner: Tornike. Zip To Zip Moving (NJ/PA/NY/DE/CT/MA). 22 foremen = 17 Active + 5 backup. 19 trucks = 9 active. 6 bases. Planning ~mid-June 2026. (Spells it "Forman".)
- ZipDispatch = live daily dispatch board. LIVE, stable, DO NOT regress.
- ZipCleanup = looks 5–14 days ahead, finds days where core crews can't cover routes, recommends cheapest fix. Actively building.

## LIVE URLS
- Dispatcher: https://tornikez2z.github.io/zipdispatch/  (index.html sha 964393c50e70 — UNTOUCHED, leave alone unless asked)
- Cleanup: https://tornikez2z.github.io/zipdispatch/cleanup.html  (latest commit 49361f3bd561)

## DEPLOY / ENV
Repo TornikeZ2Z/zipdispatch, branch main. Push = GET sha then PUT base64 to api.github.com/contents/<path>.
GitHub PAT (Contents R/W only, repo-scoped, expires ~Sep 2026 — keep private, rotate if leaked):
<<PASTE GITHUB PAT HERE — Tornike has it; not stored in repo for security>>
PAT canNOT create repos or enable Pages.
HERE Routing v8 key (embedded; truck mode, routingMode=fast; flagged exposed, should rotate): `0IGXB_hGz84InzFmhfCygxp27_54NI-LkjL6N5RSYT8`
bash network allows github.com, api.github.com, raw.githubusercontent.com, npm/pypi/crates.
jsdom harness: replace Leaflet script with Proxy stub `window.L=new Proxy(function(){return window.L;},{get:()=>window.L,apply:()=>window.L})`; replace Google GSI with `window._gsiFail=1`; `fetch=()=>Promise.reject`; stub scrollTo/scrollIntoView/matchMedia. App globals NOT on window — use w.eval.

## ZIPCLEANUP — AUTHORITATIVE SPEC (locked)
OBJECTIVE: tiered "2-crew buffer," measured in ROUTES (a chained 2–3 job route = 1 foreman = 1 crew-day).
Per day: availableCore = 17 Active − anyone off (day-offs slide target down). target = availableCore − 2.
- green = routes <= target (buffer)
- amber = target < routes <= availableCore (full, no buffer, ACCEPTABLE)
- red = routes > availableCore (shortage, must act)
Opportunistic: chase buffer only when load allows; don't thrash a heavy week. Flatten by shaving heavy days toward lightest nearby days.

THREE-TIER LADDER (in order):
1. Re-chain (FREE, route optimization, no call): afternoon jobs (start >= 12:00, sold flexible) absorbed onto an existing crew. Surfaces ALWAYS, even green days. Applied automatically by engine.
2. Call the customer ($): morning jobs (start < 12:00) flip to afternoon. $100 if hop tight (<=15 min OR <=15 mi), $50 if looser but valid (<=45 min). Surfaces to chase buffer / clear shortage.
3. Move the date: chain-first on target day (anchor+window there, else fresh keeping clock time); lightest nearby day; earlier or later but NEVER before today. Last resort, only to clear shortage.

DECLINE CASCADE: "declined" reveals the next-best way to free that same crew (different customer to call, else a job to move). ANTI-THRASH: green days no action; moves only clear red. 12:00 = AM/PM cutoff.

## ZIPCLEANUP — FILES & ARCHITECTURE
- `src/engine_core.js` — DOM-free engine extracted from template2.html, proven bit-faithful on all 116 days. Embeds DATA+ZIPDB. buildRoutes, makeRoute, scoreRoute, evalForeman, assignAll, detectAutoChains, computeAutoOff, CHAIN_RULES{maxDriveMin:45,maxCF:700,lateMin:30,maxJobs:3}, matchForeman, INREGION, tripAwayMap. Embed in HTML by truncating at `if(typeof module`.
- `src/cleanup_logic.js` (v3) — CLEAN={maxArrivalHr:16,pmCutoffHr:12,windowDays:7,buffer:2,tightLinkMin:15,tightLinkMi:15,discountTight:100,discountLoose:50}. coreAvailOn, cleanWindow, _linkFeasible, bestAnchorFor, recGeo, detectChains (free PM "standard" vs paid AM "calls" w/ $100/$50), optimizeStandard, dayLoad, slotOnTarget, buildMovePool, cleanupPlan (-> availableCore/target/routes/status/standardChains/callPool/movePool/gapToBuffer/gapToCover/routesSnap), scanHorizon, solvePlan(plan,declined) (conflict-aware: calls first up to buffer gap, moves only if calls can't clear shortage; -> activeCalls/activeMoves/freed/clearedShortage/reachedBuffer/projectedRoutes/moreCalls/moreMoves).
- `src/cleanup_ui.html` — dispatcher-matched UI. Placeholders /*__DISPCSS__*/ /*__EXTRACSS__*/ /*__ENGINE__*/ /*__CLEANUP__*/. Header From-date + window select + stats strip (core crews / need attention / have buffer). Left rail = horizon pills (buffer-colored) + day detail (3-tier ladder, agree/decline/to-do buttons, scripts, cascade hints, projected-result line). Right side = CartoDB Leaflet map + HERE-routed journey panel (timed .step rows) on "show route".
- `src/cleanup_extra.css`, `src/disp_style.css` — styling (disp_style.css = verbatim dispatcher <style>).
- `src/template2.html` — full dispatcher source (4616 lines). `src/data_all.json` — 116 days/1138 jobs. `src/zipdb.json` — zip geocodes.

ASSEMBLE cleanup.html: inject the 4 pieces into cleanup_ui.html placeholders, truncating engine_core.js and cleanup_logic.js at `if(typeof module`:
`ui.replace('/*__DISPCSS__*/',disp_style).replace('/*__EXTRACSS__*/',cleanup_extra).replace('/*__ENGINE__*/',engine_trunc).replace('/*__CLEANUP__*/',cleanup_trunc)`
VERIFY: 0 leftover placeholders, 0 `module.exports`, 0 `#5B4BD6`, `#F7F6F2` present.
NODE TEST: `cat engine_core.js cleanup_logic.js > cleanup_test.js`; require it; set currentDay; call scanHorizon/cleanupPlan/solvePlan. THEN jsdom-validate; THEN PUT as cleanup.html.

## VALIDATED NUMBERS
All 116 days: standard re-chains on only 2 days (engine already auto-chains every absorbable afternoon job — KEY INSIGHT: route optimization mostly already baked in). 60 call candidates across 29 days. Only 6 red + 4 amber days need attention.
Next 14 days: only Jun 24 & Jun 26 red (18 routes vs 17 core).
- Jun 24: 1 call clears shortage = $100 Greg Kisver after Natalie Appau, arrive 15:00–16:00 -> 17 (shortage cleared, buffer not reachable = accepted "16–17"). Decline Greg -> cascade offers Natalie after Greg.
- Jun 26: zero valid calls -> 1 move, Nancy Van Brunt -> Sun Jun 14 (lightest, spare 8) -> 17. Decline -> offers Laura Bembridge.
- Green days (e.g. Jun 16): zero actions, already holds the buffer.
All passed a clean jsdom run.

## DISPATCHER — LOCKED FACTS, DO NOT REGRESS
Follow-car chip when crew>cab seats; future-day Detach+re-chain (canChain(d){return d>=TODAY_ISO}); base=nearest pickup with chronological leg sort; full proper names in panels/roster/bench/popups, short call-name only in timeline bars + calendar title tags /#NAME#TRUCK#/; chain-only foremen (trucks reposition); Confirm system + calendar gate; open-ended rentals; 60/40 ACT split (ACT_LOAD_SHARE=0.6); PM auto-chaining (>=12:00 merged onto morning routes); start=end−ACT; Foreman-of-the-Month (FORMAN_SCORES). HERE transportMode=truck, routingMode=fast (NOT short=straight-line bug; NOT slow=toll-avoidance unwanted). NYC parkway detours are correct (truck bans).

## PENDING / NEXT
1. Calendar Connect/Update review for BOTH projects — verify write-back updates events correctly (start time, date, description, title) before trusting it. DEFERRED — do not change calendar buttons until Tornike says so. Re-chain should eventually set description "After [Customer Name]" + "After [Job Code]" and update the title — not built yet.
2. Dispatcher: Tornike clicks Connect Calendar once on the hosted URL for shared persistence + write-back.
3. Backlog (approved, not built): printable sheets, fuel rollups, AI-dispatcher chat, address-level geocoding, suggested-vs-actual past-day comparison, production build per ZIPDISPATCH_BUILD_GUIDE.md.
4. Possible cleanup enhancement (noted): detect PM re-pointing (job after A -> after X) as a route-QUALITY optimization even when it doesn't free a crew.

## WORKING STYLE
Iterative, enthusiastic: define the idea precisely, execute, validate with real numbers, then refine. Validate engine changes before deploying.
