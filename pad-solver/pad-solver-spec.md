# Puzzle & Dragons Board Solver - Single-File Design Spec & Claude Code Prompt

A **single self-contained `index.html`** (no build step, no CDN, no external assets) that runs offline by double-clicking the file, and can be hosted as one static page on GitHub Pages. It lets you (1) recreate the board you see in game, (2) describe your team's damage profile, awakenings, leader skills, and objectives, and (3) press **Solve** to get ranked orb-movement paths that maximize the desired output, respecting PAD's connected-match rule and deterministic cascades. Mobile-friendly, with procedurally drawn orbs and an animated, easy-to-read solution path overlay.

This document has two parts:

- **Part A** is the design and game-mechanics reference (the source of truth).
- **Part B** is the paste-ready Claude Code prompt that builds it in phases against Part A.

How to use: put this file at the repo root as `pad-solver-spec.md`, open Claude Code in that folder, and paste the Part B prompt. Claude Code reads this whole file for context.

---

# PART A - DESIGN & RESEARCH

## A0. Hard packaging constraints (read first)

These shape every other decision:

1. **One file.** The entire app is a single `index.html`: markup, all CSS in one `<style>`, all JS in `<script>` blocks. No separate `.js`, `.css`, or image files.
2. **No network, ever.** No CDN links, no web fonts, no remote images, no analytics. It must work opened as `file://` with the machine offline, and identically from GitHub Pages.
3. **No build step.** No npm, bundler, or transpile. Plain modern browser JS (ES2020+ is fine). It just opens.
4. **No bundled copyrighted assets.** Orbs are drawn procedurally as inline SVG/CSS (see A11). Do not embed the game's sprite PNGs. Leave a documented hook so a user can drop in their own local sprite sheet if they want.
5. **Mobile-first.** Works well on a phone-width screen with touch input (see A12).
6. **Responsiveness under load.** The solver runs in a Web Worker created at runtime from an inline Blob so the UI never freezes (see A10 and A13), with a main-thread fallback.

## A1. Board model

| Size | Grid | Orbs | When it appears |
|---|---|---|---|
| Small | 5 wide by 4 tall | 20 | Some dungeons; certain leaders |
| Default | 6 wide by 5 tall | 30 | Standard board |
| Large | 7 wide by 6 tall | 42 | Granted by certain leader skills or badges regardless of dungeon; about 4 extra potential combos |

Support all three sizes and keep the team/profile settings when switching sizes. Store the board as a flat typed array indexed `row * width + col`, origin top-left.

**Free-move match-3 mechanic:** the player picks up ONE orb and drags it; every step swaps the held orb with an orthogonally (and, if enabled, diagonally) adjacent orb. Matches only resolve when the orb is released, not per swap. A "solution" is therefore a **start cell** plus an ordered list of **directional steps**. Diagonal movement exists in game but is hard to execute, so it is **off by default** behind a toggle.

## A2. Orb types & states

Primary matchable orbs: Fire (R), Water (B), Wood (G), Light (L), Dark (D), Heart (H). Obstacle orbs: Jammer (J), Poison (P), Mortal Poison (M). Optional later: Bomb.

- Jammer matches only with Jammers, Poison only with Poison, Mortal Poison only with Mortal Poison. They add to combo count but deal no attack.
- Heart matches heal and are the trigger for many bind-recovery ("cleanse"-style) effects.

Orb **states** are flags layered on any orb, matched normally unless noted:

- Enhanced (+): flat damage bonus; persists if the orb is later changed by a skill.
- Locked: not changed by orb-change skills, but moves and clears normally; can share a combo with unlocked orbs.
- Blind / cloud / tape: movement/visual obstacles, low priority.

Represent an orb as `{ type, enhanced?, locked? }`.

## A3. Matching & combo rules (where PAD differs from normal match-3)

1. A match is 3 or more of the same orb type in a straight horizontal or vertical line.
2. **Connected same-type matches merge into ONE combo.** A 2x3 block of one color is a single combo, not two. An L, T, or plus made of one color connected through a shared orb is a single combo. This is the most important rule and the usual source of bugs. Implement detection as: for each cell, mark it "cleared" if it participates in any horizontal run of 3+ OR any vertical run of 3+ of its color; then flood-fill cleared cells by color; each flood-filled region is one combo, and its orb count is the region size.
3. Matching 5+ orbs in one combo lets that attribute hit all enemies (mass attack). Track "combo size >= 5" per combo.
4. Jammer/Poison/Mortal-Poison form their own combos by the same rules and count toward total combo count.

## A4. Cascades / skyfall

After matches clear, remaining orbs fall by column, then empty cells at the top refill.

- **Deterministic cascade (must simulate):** existing orbs falling can line up into NEW matches with no new orbs. These are guaranteed extra combos. The evaluator loops `find matches, clear, gravity, repeat until stable`, counting every wave's combos, with NO random refill during this loop.
- **Random skyfall (do not rely on):** refill orbs are RNG. A solver must not promise combos that depend on lucky drops. Provide a toggle "assume no skyfall matches" (default ON) versus an experimental estimate. Default behavior counts only deterministic cascades.

The board evaluator returns, for the released board: total combos including deterministic cascade waves, plus per-color and per-shape features aggregated across all waves.

## A5. Damage model (foundation for scoring)

Per-attribute damage for one monster, roughly:

```
matchMultiplier    = 1 + 0.25 * (orbsInThatColorMatch - 3)   // per matched group: 4 orbs = 1.25x, 5 = 1.5x
comboMultiplier    = 1 + 0.25 * (totalCombos - 1)            // each extra combo adds 25%
attributeAdvantage = 2.0 vs weak target, 0.5 vs resistant, else 1.0
subAttribute       = 0.10 if sub == main, 0.30 if sub != main
```

Attribute wheel: Fire beats Wood beats Water beats Fire; Light and Dark beat each other. "Beats" is 2x when your element is strong against the enemy, 0.5x when weak. Leader skills apply as a multiplier AFTER the combo calculation, and two leaders stack multiplicatively (leader times friend-leader).

Awakening damage multipliers (verified magnitudes, kept as editable config because GungHo rebalances them):

| Awakening | Trigger | Effect | Stacking |
|---|---|---|---|
| Two-Pronged Attack (TPA) | a matched group of exactly 4 connected orbs of the attribute | 1.5x to that monster, hits 2 targets | multiplicative: `1.5^n` |
| Enhanced Row | a full horizontal row of the attribute (6 wide on a 6-board, 7 on a 7-board) | +20% team ATK for that attribute | additive: `1 + 0.2 * rows * n` |
| Damage Void Piercer (VDP) | a 3x3 square, exactly 9 connected orbs of the attribute | 2.5x to that monster, pierces damage void | multiplicative; does NOT multiplicatively combine with TPA/L on the same combo (added instead) |
| Enhanced Combos ("7c") | total combos >= 7 | 2x to that monster | multiplicative: `2^n` |
| L-Unlock ("L") | an L pentomino of the attribute (a 3-line plus 2 turning 90 degrees at an end, 5 orbs) | damage boost plus removes binds (cleanse-adjacent) | per its rules |
| Super Enhanced Match | 12+ connected orbs of the attribute | 12x to that monster (owner only) | applies once |
| Create Combo Orb | 10+ connected orbs of the attribute | skyfalls a Combo Orb next turn | not scored |
| Follow-up attack | 5 hearts in a column | follow-up hit | niche |

Enhanced (+) orbs add a flat per-orb bump; low priority for v1, keep a hook. A perfectly exact number is not required; relative ranking is what matters. Keep all constants in one tunable config object.

## A6. Shapes the solver must detect (per color, per cascade wave)

Implement each as a pure function over the cleared cells of one color:

- **connectedSize:** size of each connected region (drives 4=TPA, 9=VDP if 3x3, 12+=super match, 10+=combo orb, 5+=mass attack).
- **isTPA:** a region of exactly 4.
- **isVDP:** a region of exactly 9 whose bounding box is 3x3 and fully filled.
- **isRow:** a cleared horizontal line spanning the full board width for that color.
- **isColumn:** a full vertical line.
- **isLShape:** an L pentomino (5 cells, a 3-line and a 3-line sharing one corner).
- **isCross:** a plus pentomino (center plus 4 orthogonal neighbors, exactly 5, nothing else attached; used by cross and heart-cross leads such as Kaede/Myr).
- **distinctAttributesMatched:** how many of the 5 colors (and heart) produced at least one combo this turn (rainbow / multi-color leads).
- **heartComboSize:** for heal, bind recovery, heart-cross, follow-up.

Aggregate all of these across every wave into one `BoardFeatures` object that scoring consumes.

## A7. Leader-skill taxonomy → scoring

Model **archetypes** the user selects and parameterizes, not thousands of named leaders. Two leader slots (leader and friend), each chosen independently. Each archetype contributes required conditions plus a damage multiplier when met.

| Archetype | Condition (parameterized) | Contributes as |
|---|---|---|
| Flat multiplier | none (attribute/type filter) | constant multiplier |
| Combo-count lead | combos >= X (often scaling per combo to a cap) | reward on total combos |
| Connected-orbs lead | a match of >= N connected orbs | reward max connected size >= N |
| Multi-color / rainbow lead | match >= K distinct attributes (4 to 5 colors, optionally + heart) | reward `distinctAttributesMatched >= K` |
| Specific-color lead (e.g. Kali) | match these specific colors | require each listed color has >= 1 combo |
| Row lead | match >= R rows | reward full rows |
| Cross lead | match crosses of specified colors | reward cross shapes of those colors |
| Heart-cross lead (Kaede/Myr) | heart cross | reward heart cross, plus damage reduction |
| HP-conditional lead | HP above or below a threshold | treat as always-on multiplier (HP is out of board scope) |
| Board-expand lead | grants 7x6 or 5x4 | sets board size, not a score term |
| L-lead | match L shapes | reward L shapes of team colors |

The scoring engine reads the two selected archetypes, checks conditions against `BoardFeatures`, and folds their multipliers in. Ship a preset library (Rainbow, Combo, Mono Row, TPA-spike, VDP-spike, Heart-cross, 7-combo) mirroring how padopt and pazusoba ship profiles.

## A8. Team / attack profile (settings the user edits)

Express the team as weights/config, not full monster stats:

- **Team colors:** per attribute, a weight approximately equal to the number of monsters that attack with that color (convention: `1` per main-attribute monster, optionally `+0.3` per matching sub).
- **Awakening counts by shape, per color:** number of TPA / VDP / row / 7c / L awakenings on the team for each color; these raise the value of making that shape in that color.
- **Global awakenings:** total 7c count for the combo-threshold reward, etc.
- **Leader plus friend archetype** (A7).
- **Target enemy (optional):** enemy attribute for the 2x/0.5x advantage, and flags such as has-damage-void (makes VDP valuable) and has-damage-absorb.

## A9. Objectives & constraints (the "trigger cleanse / specific ability" part)

Separate from the damage profile, expose the real PAD triggers as hard objectives and soft bonuses that gate or steer the search:

- Must clear all Poison / Mortal Poison / Jammer orbs (constraint).
- Match >= N connected Hearts (constraint or bonus): the trigger for bind/awoken-bind recovery ("cleanse") and heart-cross/follow-up.
- Make >= C combos (constraint): combo-gated leader skills or combo shields.
- Ensure >= 1 match of each required color (constraint): rainbow/specific-color leads.
- Produce at least one VDP / row / cross / L (constraint): when a specific awakening or leader must fire this turn.

Hard constraints apply a large negative penalty to solutions that fail them; soft bonuses add weighted score. This supports "solve for max damage but it must clear all poison and make a 4+ heart match."

## A10. Solver algorithm

The state space is astronomically large (roughly `30 * 3^25` reachable boards at depth 25 for 6x5), so true optimality is out and the job is to find great paths fast. Reuse the proven approach as the baseline, then layer on the upgrades below behind a **strategy selector** so the app can compare them. Everything here must run in the inline worker with an anytime, cancelable, time-budgeted loop that streams best-so-far results.

### A10.1 Baseline: beam search (reuse the proven approach)

This is what pazusoba and the padopt lineage converge on; keep it as the default engine.

1. **State** is `{ board, cursor, path }`, where `path` is the steps from the start cell.
2. **Seeds:** consider every cell as a possible start (optionally sample to speed up). Each seed spawns an initial state.
3. **Expansion:** move the cursor to each legal neighbor (4 orthogonal, plus 4 diagonal if enabled), swapping orbs. Skip the immediate reverse move.
4. **Depth limit:** `maxSteps`, default 30, exposed 10 to 50.
5. **Beam width:** keep the top `beamWidth` states by heuristic, default about 1000, exposed up to about 20000 (wider is better and slower) via a fixed-size priority queue. Prefer a **global best-first priority queue** capped at total node budget (pop best, expand, push children) over strict level-by-level truncation; it is more flexible and is effectively what pazusoba does.
6. **Heuristic:** the score of the board if released now (A10.3).
7. **Result:** top-N distinct final paths with a per-path feature breakdown (combos, shapes, colors, objective pass/fail, path length).

### A10.2 State, moves, and pruning (the biggest cheap wins)

- **Global transposition table.** Many different paths reach the same board. Keep a hash set/map of visited `(board, cursor)` with the best score/shortest length seen; skip or replace dominated re-visits. This prunes far more than the baseline "skip reverse move" and is the single largest speedup.
- **Zobrist hashing.** Give every `(cell, orbType)` a random 64-bit key; maintain the board hash **incrementally**, XORing out/in only the two swapped cells on each move, so hashing is O(1) per expansion instead of rehashing the whole board. Combine cursor position into the key.
- **Cycle pruning.** Never revisit a `(board, cursor)` already on the current path.
- **Move ordering.** Expand children in descending heuristic order so the best-first queue and any pruning see good states first; this improves anytime quality.

### A10.3 Two-tier scoring (fast in the loop, accurate on finalists)

Evaluating every node with an expensive score is the bottleneck. Split it:

- **Tier 1 (in-loop, must be cheap):** deterministic resolve-plus-cascade simulation (A4), then `BoardFeatures` (A6) and `scoreBoard` (A5, A7 to A9), plus a cheap skyfall proxy (A10.5). Use **incremental / localized match evaluation** where possible: after a swap, only re-examine the rows and columns touched by the two moved cells rather than the whole board.
- **Tier 2 (finalists only):** take the top-N candidates from the search and re-rank them with the expensive evaluation, including the Monte Carlo skyfall estimate (A10.5) and full path-quality accounting (A10.4). This keeps the search fast while making the final ranking reflect what actually matters.

Optionally add a **potential-function heuristic** that estimates remaining improvement (for example, how few moves separate current orb clusters from a needed shape or full row), so the beam is steered toward promising regions rather than only rewarding what is already on the board. Keep it cheap and admissible-ish; a bad potential function hurts more than none.

### A10.4 Multi-objective: best result vs shortest path

The user wants both "best result" and "best result with the shortest path," which is a Pareto tradeoff between score and path length (and diagonal count). Support all three of:

- **Weighted penalty (default, simple):** per-step penalty, larger per-diagonal penalty, optional penalty beyond a comfort length. Tunable weights.
- **Lexicographic:** find the max score, then among solutions within an epsilon of it, return the one with the fewest steps (and fewest diagonals). This is usually what a player wants: "give me the shortest way to essentially the best board."
- **Pareto frontier:** track non-dominated `(score, length)` solutions and return several, so the results list can label them, for example "Max score", "Shortest path within 98% of best", and one or two in between. Let the user pick the tradeoff rather than baking in one weight.

Return these as distinct entries in the results list so the choice is visible.

### A10.5 Cascade and skyfall setup (valuing future combos)

Three layers, cheap to expensive:

- **Deterministic cascades (already required, A4):** count guaranteed extra combos from existing orbs falling after the main clear. Always on; this is real, not luck.
- **Cheap skyfall proxy (Tier 1):** reward board states that are *likely* to cascade or skyfall without simulating randomness, for example leftover same-color orbs left adjacent or stacked in columns (more likely to line up when orbs drop), or a high count of "one orb away from a match" spots. Fast enough to use inside the search, and directly serves "best combo with a chance to set up cascades and skyfall."
- **Monte Carlo skyfall estimate (Tier 2, finalists only):** after the deterministic resolve, the board has empty cells; sample K random refills consistent with the game's drop distribution, resolve each, and average the extra combos/score. This yields an expected-value bonus that rewards setups with genuine skyfall upside, computed only on the handful of finalist paths so it stays affordable. Expose a toggle and a sample count; keep the default guaranteed-only ranking honest by clearly separating "guaranteed" from "expected with skyfall" in the breakdown.

### A10.6 Alternative search engines (behind a strategy selector)

Offer these as selectable engines so the app can benchmark speed and quality; beam search stays the default:

- **Iterative deepening DFS + branch-and-bound:** memory-light, naturally finds short paths first, prunes branches that cannot beat the current best (needs an optimistic upper bound). Good when shortest-path solutions are the priority.
- **Beam-stack search / BULB (beam search with limited-discrepancy backtracking):** keeps beam's speed but recovers the completeness/quality that plain beam loses by discarding nodes; a strong drop-in upgrade when a wider beam is too slow.
- **Monte Carlo Tree Search (MCTS):** each swap is an action; roll out to a release and backpropagate the resolved score. Rollouts naturally value future potential, which fits the cascade/skyfall-setup goal well, and it self-balances exploration vs exploitation. Can find creative paths; may converge slower than a tuned beam on this deterministic problem, so treat as an experimental engine.
- **Metaheuristics (genetic algorithm / simulated annealing) over the path sequence:** encode a path as a sequence of moves, then mutate/crossover (GA) or perturb with cooling (SA), evaluating the resolved board. Easy to parallelize and good at escaping local optima; usually a worse bang-for-buck than beam, but useful for hard boards and for a second opinion.
- **Why not plain A\*:** there is no fixed goal state (the goal is "maximize score"), and no natural admissible distance-to-goal, so classic A\* does not map cleanly. Weighted best-first / beam is the right frame; the potential function in A10.3 is the closest useful analog.

### A10.7 Template-guided search (fast wins for known archetypes)

Expert "optimal board" compilations show that for a given team archetype the ideal final arrangement is often known in advance (bicolor combo boards, full rows for row teams, 2x2 boxes for TPA, a 3x3 for VDP, a plus for cross/heart-cross leads). For a selected archetype, generate one or more **target board templates**, then solve the cheaper problem of arranging orbs toward the nearest template (score by similarity to the template plus the normal evaluator). This can be dramatically faster and higher quality than blind maximization for those teams, and it degrades gracefully to the general search when no template fits. Make it optional and driven by the chosen leader/profile.

### A10.8 Performance engineering (so wider searches stay fast)

- **Typed arrays and object pooling** for boards; avoid allocations in the hot loop; reuse buffers per depth.
- **Bitboards:** represent each color as a bitmask over the up-to-42 cells (two 32-bit ints or a BigInt); detect runs via shifts and masks. Fast match detection on the large board.
- **Incremental evaluation:** re-check only the rows/columns affected by the last swap (pairs with A10.3 Tier 1).
- **Parallel workers:** spawn several inline-Blob workers, each seeded from a different start cell (or running a different engine or beam), and merge their results. The single-file constraint still allows multiple runtime-built workers. Big speedup on multi-core phones and desktops.
- **Anytime + time budget:** always keep the best-so-far, stream progress, honor a wall-clock budget and a cancel button, and let the user trade time for quality with the beam-width / node-budget knobs.

Ship sensible defaults (baseline beam + transposition table + Zobrist + Tier-1 proxy + lexicographic shortest-of-best) and expose the rest as advanced toggles, so a first-time user gets fast, good, short paths without touching a single setting.

## A11. Orb rendering (procedural, self-contained)

Draw every orb as inline SVG with gradients so the file stays offline, small, and crisp at any size, and to avoid bundling copyrighted sprites. Recommended approach: define one reusable SVG `<symbol>` per orb type inside a hidden `<svg>` in the document, then `<use>` it in each board cell (or in the SVG overlay). Each orb is a glossy sphere: a radial gradient for the body, a soft inner shadow at the bottom, and a small specular highlight near the top, plus a distinguishing glyph so it also reads without color (colorblind-friendly).

PAD-accurate palette and glyphs:

- Fire (R): red to deep orange radial, flame glyph.
- Water (B): blue to cyan radial, droplet glyph.
- Wood (G): green to lime radial, leaf glyph.
- Light (L): gold to pale yellow radial, sunburst or star glyph.
- Dark (D): violet to magenta radial, crescent-moon glyph.
- Heart (H): pink to rose radial, heart glyph.
- Jammer (J): gunmetal to black radial, gear / mechanical glyph.
- Poison (P): purple radial, skull glyph.
- Mortal Poison (M): darker magenta radial, skull glyph with a ring to distinguish from Poison.
- Empty: a dim recessed slot.

Orb-state overlays: Enhanced (+) shows a bright ring or a small plus badge and a subtle glow; Locked shows a thin chain/lock overlay. Keep glyphs simple so they stay legible at phone cell sizes. Document a hook (for example a config flag and a CSS class) so a user can point cells at their own local sprite sheet instead of the SVG symbols.

## A12. Mobile-friendly UI

- **Responsive board:** the board scales to viewport width; cells use CSS grid with `aspect-ratio: 1`; orb SVGs scale via `viewBox`. No horizontal scroll; include the viewport meta tag.
- **Touch editing:** provide an orb-type **palette** the user taps to select a "paint" type, then taps cells to set them (do not rely on right-click, which does not exist on touch). Offer a quick toggle for the enhanced/locked flags. Support tap-and-drag to paint multiple cells.
- **Tap targets:** interactive controls at least about 44px; cells large enough to tap accurately.
- **Layout:** put Board, Team/Leader, Objectives, and Solve/Results into collapsible sections or tabs so each fits a small screen. No hover-only interactions.
- **Playback controls** (see A13) are large, thumb-reachable buttons.

## A13. Path visualization & playback (called out as a priority)

Draw the selected solution as an **SVG overlay layer** absolutely positioned over the board grid, sized to the same coordinate space, with `pointer-events: none` so it never blocks editing. The path connects the centers of the visited cells.

Make it easy to read:

- **Line:** a thick, round-capped, round-joined `<path>` through the cell centers, with a **gradient stroke** (an SVG `linearGradient` running start-to-end, for example cool-to-warm, so direction is obvious) and a soft outer glow or drop shadow (a blurred darker copy underneath) for contrast against colorful orbs. Keep the line semi-transparent so orbs remain visible.
- **Flow animation:** animate `stroke-dashoffset` on a dashed copy of the path to create a continuous flowing motion in the direction of travel. Optionally animate a moving gradient as well.
- **Draw-on animation:** on selecting a solution, animate the path drawing from start to end (animate `stroke-dasharray` / `stroke-dashoffset` from empty to full) so the sequence is clear.
- **Direction arrows:** place arrowheads along the path using SVG `<marker>` (marker-mid/marker-end) or repeated chevrons, with a contrasting fill and a thin outline so they pop against any orb color. Scale arrow size with cell size.
- **Start and end markers:** a pulsing ring on the start orb and a distinct marker on the final cell.
- **Overlaps:** when the path crosses itself, offset or slightly curve segments (or vary opacity) so crossings stay legible rather than blending into one blob.
- **Step-through playback:** a play/pause button, a step slider, and a speed control. Playback moves the cursor along the path, swapping orbs on the board at each step, then plays the clear-plus-cascade resolution wave by wave (fade/scale out cleared orbs, drop remaining orbs, reveal the next wave), and finally shows the resulting board and the feature breakdown. All controls are large and thumb-friendly.

Everything here is pure SVG/CSS animation so it stays self-contained and smooth on mobile.

## A14. Board import/export

- **Manual editor:** palette-based painting (A12); buttons to fill, clear, randomize (randomize must avoid pre-existing matches), and toggle orb states.
- **Board string:** a documented compact encoding, one char per cell, row-major, using `R B G L D H J P M` and `o` for empty. Copy/paste supported.
- **Dawnglare interop (nice-to-have):** emit and accept a string compatible with `pad.dawnglare.com` so a board or solve can be cross-checked in the community-standard simulator. If the exact encoding needs confirming, match its orb-letter order against a live Dawnglare board URL; keep our native encoding as the source of truth and Dawnglare as an export view.
- **Screenshot import (optional, later):** local canvas analysis of an in-game screenshot to auto-fill the board, no upload. Defer; it is the least reliable part.

## A15. Testing without a build step

Because there is no bundler, ship a tiny inline test harness reachable at `index.html?test` (or via a hidden "Run self-tests" button) that runs assertions and prints pass/fail to the page and console. Cover the two riskiest areas hardest: the connected-match merge rule (2x3 block = 1 combo; connected L/T/+ of one color = 1 combo) and deterministic cascades (existing orbs falling create new combos with no skyfall), plus fixtures for each shape detector (TPA=4, VDP=3x3, row, L, cross, distinct colors) and a couple of end-to-end scoring checks.

## A16. What to borrow from existing solvers

- **padopt** (JS web app; lineage kennytm `pndopt`, `combo.tips`): closest analog. Take its profile/weight model (weights on colors plus shapes, solve for weighted score), its single-page UI supporting 6x5 and 7x6, and its local screenshot import. Its solver is brute-force greedy and it openly ignores cascades, the move timer, and path complexity, so improve on all three. It is AGPL-3.0, so treat as inspiration and keep our implementation independent.
- **pazusoba/core** (C++): take its fixed-size priority-queue beam search and its profile types (Combo, Colour, Shape covering 2U/TPA, +, L, one row, void-pen, and Orb). This is the better algorithm to emulate. Its author notes true-optimal is impossible, so aim for good, short, cascading, high-combo, fast.
- **byronxu99/PADsolver, culaucon/pad-solver, Aw205/PADSolver:** further references for board simulation, Dawnglare orbcodes, and screenshot pipelines (out of scope here, useful reading).
- **Dawnglare simulator** (`pad.dawnglare.com`): the community-standard editor/simulator; use as the interop target and for manual verification.

## A17. Recommended structure inside the one file

Vanilla JS, no framework. Suggested top-level modules as separate `<script>` blocks or clearly separated sections in one block:

- `engine`: OrbType enum, board type (typed-array backed), clone, applySwap, gravity, and `resolveBoard()` that loops find-matches, clear, gravity, counting deterministic cascade waves. Plus matching (connected merge per A3), shapes (A6), and features (A6 aggregate). Keep this pure and DOM-free.
- `score`: constants config (A5), leader archetypes (A7), presets, `scoreBoard(features, teamConfig, leaders, objectives)` returning `{ score, breakdown }`.
- `solver`: beam search (A10). At runtime, build the Web Worker from the engine-plus-solver source via a Blob (for example a `<script type="javascript/worker">` block read with `textContent`, or a serialized function). The same engine functions must also be available on the main thread for playback and live preview; avoid duplicating the source. Include a main-thread fallback if Workers or Blob URLs are unavailable.
- `render`: procedural orb SVG symbols (A11), board grid rendering, the path overlay and animations (A13).
- `ui`: palette editor, team/leader/objective panels, solve trigger and results list, playback controls, localStorage load/save, board-string import/export.

---

# PART B - CLAUDE CODE PROMPT (paste this)

Paste the block below into Claude Code, opened in the folder that contains `pad-solver-spec.md`.

```
Build a single self-contained index.html: a Puzzle & Dragons board solver. The full design and game-mechanics reference is pad-solver-spec.md in this repo. Read it in full before writing code and treat Part A as the source of truth. Follow the phases below; after each phase, stop, summarize, open the file to sanity-check it renders, and wait for my go-ahead.

NON-NEGOTIABLE PACKAGING (Part A0):
- Everything lives in ONE index.html: markup, all CSS in one <style>, all JS in <script> blocks. No separate .js/.css/image files.
- No network of any kind: no CDN, no web fonts, no remote images, no analytics. Must work opened as file:// while offline, and identically on GitHub Pages.
- No build step: plain modern browser JS, no npm/bundler/transpile. It just opens.
- No bundled copyrighted assets: orbs are drawn procedurally as inline SVG with gradients (Part A11). Leave a documented hook to swap in a local sprite sheet.
- Mobile-first with touch input (Part A12). Solver runs in a Web Worker built at runtime from an inline Blob, with a main-thread fallback (Part A10, A17).

CODE STRUCTURE (keep boundaries clean; engine is pure and DOM-free): engine (board, matching with the connected-merge rule, resolveBoard with deterministic cascades, shapes, features) / score (constants config, leader archetypes, presets, objectives) / solver (beam search, inline-Blob worker, fallback) / render (procedural orb SVG symbols, board grid, animated path overlay) / ui (palette editor, panels, results, playback, localStorage, board-string IO). Keep all damage/awakening constants in one config object.

PHASE 1 - Skeleton + orbs + editor. One index.html that renders a responsive board grid for 5x4 / 6x5 / 7x6 with a size switcher that preserves settings. Draw all orb types as inline SVG symbols with radial-gradient glossy spheres plus a distinguishing glyph per type and enhanced/locked overlays (Part A11), colorblind-legible. Palette-based touch editor (Part A12): tap a type to select, tap/drag cells to paint; fill/clear/randomize (randomize must avoid pre-existing matches). Verify it opens offline and looks right on a phone-width viewport.

PHASE 2 - Engine + inline self-tests. Implement matching (connected-merge per Part A3), resolveBoard (deterministic cascades, NO random skyfall), shapes (Part A6: connectedSize, TPA=4, VDP=3x3, row, column, L, cross, distinctAttributes, heartComboSize), and features aggregation. Add the inline test harness at ?test (Part A15): hammer the connected-merge rule (2x3 block = 1 combo; connected L/T/+ = 1 combo) and deterministic cascades hardest, plus a fixture per shape detector. Print pass/fail to the page and console.

PHASE 3 - Scoring + leaders + objectives. Implement the constants config (Part A5), leader archetypes (Part A7) as parameterized objects returning {conditionMet, multiplier} from features, the preset library (Rainbow, Combo, Mono Row, TPA-spike, VDP-spike, Heart-cross, 7-combo), and scoreBoard combining a weighted-profile mode with a damage-estimate layer, applying objectives as hard-constraint penalties and soft bonuses (Part A9). Add self-tests that presets score representative boards sensibly and that a "clear all poison" constraint fails a board that leaves poison on it.

PHASE 4 - Solver in a worker (Part A10). Reuse the proven beam approach as the baseline, then layer on the smarter pieces. You may checkpoint between 4a and 4b.
  4a Baseline + core speedups: global best-first priority queue capped by a node budget (beamWidth default 1000, up to ~20000) to maxSteps (default 30), seeded from candidate start cells, expanding by cursor moves (4-dir; 8-dir behind a flag; skip immediate reverse). Add the global transposition table with incremental Zobrist hashing and cycle pruning (A10.2), and two-tier scoring (A10.3): a cheap in-loop evaluation using the deterministic resolve plus a skyfall proxy with localized (touched rows/columns only) match re-eval, and an expensive re-rank on the top-N finalists. Build the worker from the engine+solver source via an inline Blob so the UI never freezes; provide a main-thread fallback. Anytime behavior: stream best-so-far, honor a wall-clock time budget and a cancel button. Return top-N distinct paths with score + breakdown + step list + start cell.
  4b Smarter search: multi-objective output (A10.4) returning at least Max-score, a lexicographic Shortest-path-within-epsilon-of-best, and one or two Pareto points on score vs path length, each as its own labeled result. Cascade/skyfall setup (A10.5): deterministic cascades always on, a cheap in-loop skyfall proxy, and a Monte Carlo skyfall estimate computed on finalists only, with the breakdown clearly separating guaranteed from expected-with-skyfall. A strategy selector (A10.6) exposing beam plus at least one alternative engine (for example iterative-deepening + branch-and-bound or beam-stack/BULB; MCTS or GA optional/experimental). Optional template-guided search for the chosen archetype (A10.7) and optional parallel inline-Blob workers seeded by start cell (A10.8).
  Expose settings: engine, beamWidth, node/time budget, maxSteps, allowDiagonal (default false), assumeNoSkyfall (default true, affects ranking), skyfall sample count, per-step and per-diagonal penalties, and objective-weight vs path-length-weight. Ship defaults that need zero tuning: beam + transposition table + Zobrist + Tier-1 proxy + lexicographic shortest-of-best.

PHASE 5 - Solve UI + path visualization (priority, Part A13). A Solve button runs the worker and shows a ranked results list. Because the solver is multi-objective (A10.4), label the distinct options clearly, for example "Max score", "Shortest path (>= X% of best)", and any Pareto in-betweens, and show for each: score, combo count (guaranteed vs expected-with-skyfall), shapes made, colors cleared, objective pass/fail, and path length. Selecting a solution draws it as an SVG overlay over the board (pointer-events:none): a thick round gradient-stroked path with a glow, animated flowing dashes for direction, a draw-on animation on select, clearly visible arrowheads along the path, a pulsing start marker and a distinct end marker, and legible handling of self-crossings. Add step-through playback with play/pause, a step slider, and a speed control: move the cursor along the path swapping orbs, then animate the clear-plus-cascade wave by wave, then show the final board and the feature breakdown. Controls are large and thumb-friendly.

PHASE 6 - Persistence, IO, polish. localStorage load/save for profiles and last board. Board-string import/export (one char per cell, row-major: R B G L D H J P M and o for empty) plus a Dawnglare-compatible export (confirm letter order against a live pad.dawnglare.com board; keep native as source of truth). Final offline check (open file:// with the network off; confirm zero requests). Add a short in-file About/README section covering how to run, the board-string format, the tunable scoring constants, and credits to the reference projects (padopt/pndopt/combo.tips and pazusoba) as inspiration.

OPTIONAL PHASE 7 - Local screenshot import: client-side canvas analysis of an in-game screenshot to auto-fill the board, no upload. Least reliable; only after everything else is solid.

QUALITY BARS:
- The connected-merge rule and deterministic-cascade simulation are the likeliest bugs; test them hardest.
- Never present skyfall-dependent combos as guaranteed: default assumeNoSkyfall = true, keep the deterministic (guaranteed) count separate from any Monte Carlo expected-with-skyfall figure, and only compute the expensive skyfall/finalist evaluation on the top-N, not in the inner loop.
- The transposition table must key on both board and cursor, and must never let a worse/longer revisit evict a better/shorter one; get this right or the search returns wrong paths.
- Keep the solver anytime: always hold a best-so-far, stream progress, and honor the time budget and cancel button so the UI never blocks.
- Zero network requests; verify offline. One file only. No build step. Mobile-first.
- Keep all damage/awakening constants in one config object.
- Prefer clarity over cleverness; comment the matching, beam-search, transposition-table, skyfall-estimation, and path-overlay code well.
```

---

## Quick reference: verified numbers

- Combo multiplier `1 + 0.25*(combos-1)`; per-match orb bonus `1 + 0.25*(orbs-3)`.
- Attribute advantage 2x strong, 0.5x weak; wheel Fire beats Wood beats Water beats Fire, Light and Dark beat each other.
- Sub-attribute worth 10% (same as main) or 30% (different) of that monster's ATK.
- TPA: exactly 4 connected, 1.5x per awakening (multiplicative), hits 2 targets.
- VDP: 3x3 = exactly 9 connected, 2.5x, pierces damage void; does not multiplicatively stack with TPA/L on the same combo.
- Enhanced Row: full-width horizontal line, +20% team ATK for that attribute per awakening (additive).
- Enhanced Combos ("7c"): combos >= 7, 2x per awakening (multiplicative).
- Super Enhanced Match: 12+ connected, 12x owner. Create Combo Orb: 10+ connected. Mass attack: match >= 5.
- Board sizes 5x4 / 6x5 / 7x6 (7x6 granted by certain leaders/badges).

Treat all magnitudes as tunable config; verify against a live database (puzzledragonx.com or the PAD Fandom wiki) for current exact values, since GungHo rebalances awakenings periodically.
