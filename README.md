# mc-parallel-agent

A Minecraft agent driven by Claude. It gets only the abilities a real player has (keyboard, mouse, inventory, chat). Unlike a human, it can run several of those abilities **at the same time** through a tick-driven scheduler, and its reaction speed is a setting you can turn up or down.

This is a response to Emergent Garden's post-mortem on [Mindcraft](https://github.com/kolbytn/mindcraft). That video blamed brittle bot-framework glue, race conditions, hand-written skills that break, and bugs like the infinite-jump pathfinder. The project goal here is to show what a sturdier foundation looks like.

```
            Claude (seconds per decision)                   ← deliberative: WHAT to do
     parallel tool calls: move_toward + look_at + mine
                          │  enqueue (never blocks the game)
                          ▼
   ┌──────────── ActionScheduler (20 Hz, one loop) ────────────┐
   │ channels:  LEGS │ HEAD │ HANDS │ INVENTORY │ CHAT          │ ← WHEN / HOW: arbitration,
   │ admit every N ticks, ≤ M starts per window (the APM dial)  │   preemption, timeouts,
   │ priority preemption · timeouts · stall watchdog            │   no-progress watchdog
   └────────────────────────────────────────────────────────────┘
        ▲ reflexes (eat, surface for air) at high priority     ← fast: things that can't wait for an LLM
                          │
                     mineflayer bot  ↔  Minecraft server
```

## How the parallel "queue switcher" works

- **Body channels.** Every ability declares which body channels it occupies:
  - `move_toward`: LEGS
  - `goto`: LEGS + HEAD
  - `look_at`: HEAD
  - `mine`, `place`, `attack`: HEAD + HANDS
  - `eat`: HANDS
  - `equip`, `toss`: INVENTORY
  - `craft`: INVENTORY + HANDS
  - `chat`: CHAT

  Abilities on different channels run concurrently. Abilities on the same channel queue up in FIFO order. That gives the agent superhuman multitasking while it still has one body: it can walk east, look west and break a block it's passing all at once, but it can never mine two blocks at once.
- **Speed dial.** New actions are admitted only every `decisionIntervalTicks`, with at most `maxStartsPerDecision` starts per window.
  - `human`: every 4 ticks (200 ms), 1 start, about 300 APM ceiling.
  - `fast`: every 2 ticks, 2 starts.
  - `superhuman`: every tick, no cap.

  You can also set any custom values with `--decision-ticks` and `--max-starts`. Head turn rate is limited separately (`--head-speed`, default 30°/tick), so even the "superhuman" preset can't snap-aim unless you allow it.
- **Preemption.** An action with higher priority cancels lower-priority holders of the channels it needs and leaves the other channels alone. In the e2e test, an urgent `hold_keys` interrupts walking while `look_at` keeps tracking.
- **Everything is a tick-stepped state machine** driven from one `physicsTick` loop. When an action calls a mineflayer promise API, the promise is tracked by a generation counter, so a result that arrives late, after the action was cancelled, is ignored. It can't race whatever owns the channel next. Every action has an `end()` that releases its controls, and it is called exactly once, whatever the outcome.
- **Nothing runs forever.** Every action has a hard timeout. Movement actions also have a *progress watchdog*: if the distance to the goal hasn't improved in N ticks, the action fails with `stalled`. The LLM then gets that reason and can try something else. This is the structural fix for the "jumps against a wall forever" class of bug.

## Fair-play rules enforced by the body

- No slash commands (`chat` rejects them).
- Mining requires the target to be within 4.5 blocks **and** to be the first block the crosshair raycast hits. You can't mine through walls.
- Observations list only blocks **exposed to air**, so no x-ray. Buried ores stay invisible.
- The head turns at a limited speed. Attacks respect a cooldown and 3-block reach.
- Drops have to be walked over (`pickup`). 3×3 crafting needs a crafting table within reach.

## Run it

```bash
npm install
npm test                      # 11 scheduler unit tests + 7 end-to-end tests on a real server
npm run test-server           # local offline 1.21.4 server (flying-squid, pure JS) on :25565
ANTHROPIC_API_KEY=... npm start -- --speed human --goal "Get a stone pickaxe"
```

Point `--host/--port/--version` at a real vanilla or Paper server for real gameplay. The flying-squid test server is only good for physics, digging, placing and pathing; it has no mobs, no proper terrain and no hunger.

Options: `--speed human|fast|superhuman`, `--decision-ticks N`, `--max-starts N`, `--head-speed DEG`, `--effort low|medium|high`, `--model`, `--max-turns`.

The brain uses `claude-opus-5-5` with adaptive thinking at `low` effort by default, because gameplay is sensitive to latency. Raise `--effort` for harder planning. It has server-side refusal fallback enabled (`fallbacks: "default"`). Conversations are append-only within an "episode" so prompt caching works. Every 40 turns it starts a fresh episode, carrying over notes the agent saved with `remember`.

## How hard is this, honestly?

**What's tractable now (and works in this repo):**
- The action layer. The parallelism, speed limits, preemption, timeouts and fair-play constraints are ordinary engineering. Tests run them against real game physics.
- High-level decisions. Current models are good at multi-step tool use, recovering from errors ("line of sight blocked by stone at (3,4,5)" → mine that first), and issuing parallel tool calls. That's the big change compared with ~6 months ago. Planning the tech tree, deciding what to do next and reading failure messages are no longer the bottleneck.

**What's still genuinely hard:**
1. **Latency vs. 20 Hz.** An LLM decision takes about 1–10 s, which is 20–200 game ticks. Combat, parkour, falling and lava happen faster than that. The answer is layering: the LLM sets intent, while reflexes and the scheduler handle the fast part. But every fast behavior is still a hand-written reflex. This is the same "hard-coded constraints" problem from the video, just smaller.
2. **Perception.** The agent reads a structured text summary, not pixels. Asking a model for 20 screenshots a second is too slow and too expensive. A believable middle ground is a cheap structured view for routine work plus an occasional rendered screenshot (e.g. prismarine-viewer) for spatial reasoning such as building. Spatial reasoning from text coordinates is where current models are weakest.
3. **Mineflayer is still a reimplemented client.** The video is right that a bot framework outside the game's own code drifts from vanilla behaviour (bucket edge cases, new versions, entity metadata). This design limits the damage: one tick loop, no free-running promises, watchdogs everywhere. It can't remove the drift. The only full fix is a client mod running inside the real game (Fabric). That's a much bigger project, though the scheduler and brain here would port over unchanged.
4. **Pathfinding in a world the agent changes.** `mineflayer-pathfinder` still has edge cases. Here they show up as a `stalled`/`no path` failure the LLM can react to, not as a hang. That's better, but it isn't solved.
5. **Long horizons and cost.** Beating the game takes hours of play, which means thousands of API calls. Caching and low effort help. Running a full survival game on Opus is a real budget decision, and the default `--max-turns 200` keeps that bounded.

**Rough difficulty grades:**

| Goal | Difficulty |
|---|---|
| Wood → stone tools → iron, with parallel actions and adjustable APM | **Moderate.** This repo is the foundation. |
| Plays survival for hours without babysitting | **Hard.** Needs more reflexes (combat, falling, lava), better perception, and memory. |
| Plays indistinguishably from a skilled human, including PvP and parkour | **Very hard.** Needs learned low-level control (a model trained on gameplay, VPT-style) under the LLM. |

## Not done yet / known limits

- The Claude loop is tested with a scripted stand-in client (the parallel tool calls → concurrent actions path). It has **not** been run against the live API in this environment, because there was no API key.
- Reflexes (auto-eat, swimming up) are implemented but untested: the test server has no hunger or water.
- Equipping from the main inventory into the hand is treated as an instant hand action. A strict mode would make it open the inventory screen first.
- There's no vision yet. No combat reflexes (block or retreat at low health) yet.

## Layout

```
src/scheduler.ts  generic channel scheduler (no Minecraft dependency, unit-tested)
src/body.ts       physical limits, head turning, WASD-relative-to-yaw strafing, promise tracking
src/actions.ts    the player's abilities as tick-stepped actions + tool schemas
src/observe.ts    text observation (no x-ray)
src/reflexes.ts   fast deterministic reactions
src/brain.ts      Claude tool-use loop
src/agent.ts      wires bot + scheduler + reflexes + event log
test/             scheduler unit tests, end-to-end tests on a flying-squid server
```
