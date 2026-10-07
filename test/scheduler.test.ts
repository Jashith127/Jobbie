import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActionScheduler, RUNNING, done, failed, type Action, type Channel, type SchedulerConfig } from '../src/scheduler.ts';

interface Ctx { log: string[]; pos: number }

const cfg = (over: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  decisionIntervalTicks: 1, maxStartsPerDecision: Infinity, defaultTimeoutTicks: 1000, historySize: 100, ...over,
});

/** Runs for `ticks` ticks, then completes. */
function hold(name: string, channels: Channel[], ticks: number, extra: Partial<Action<Ctx>> = {}): Action<Ctx> {
  let n = 0;
  return {
    name, channels,
    start: ctx => { ctx.log.push(`start ${name}`); },
    tick: () => (++n >= ticks ? done() : RUNNING),
    end: ctx => { ctx.log.push(`end ${name}`); },
    ...extra,
  };
}

const run = (s: ActionScheduler<Ctx>, n: number) => { for (let i = 0; i < n; i++) s.tick(); };

test('actions on disjoint channels run in parallel', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const walk = s.enqueue(hold('walk', ['legs'], 10));
  const look = s.enqueue(hold('look', ['head'], 10));
  const eat = s.enqueue(hold('eat', ['hands'], 10));
  run(s, 1);
  assert.deepEqual([walk.state, look.state, eat.state], ['running', 'running', 'running']);
  run(s, 10);
  assert.deepEqual([walk.state, look.state, eat.state], ['done', 'done', 'done']);
});

test('actions sharing a channel are serialized FIFO', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const a = s.enqueue(hold('mineA', ['hands', 'head'], 3));
  const b = s.enqueue(hold('mineB', ['hands', 'head'], 3));
  run(s, 1);
  assert.equal(a.state, 'running');
  assert.equal(b.state, 'queued');
  run(s, 3);
  assert.equal(a.state, 'done');
  assert.equal(b.state, 'running', 'B starts on the same tick A frees the channels');
});

test('decision interval and start cap throttle admission (the APM dial)', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg({ decisionIntervalTicks: 4, maxStartsPerDecision: 1 }), ctx);
  const recs = (['legs', 'head', 'hands', 'chat'] as Channel[]).map(c => s.enqueue(hold(c, [c], 100)));
  const startedAt = () => recs.map(r => r.startedTick ?? null);
  run(s, 3);
  assert.deepEqual(startedAt(), [null, null, null, null]);
  run(s, 1);
  assert.deepEqual(startedAt(), [4, null, null, null]);
  run(s, 12);
  assert.deepEqual(startedAt(), [4, 8, 12, 16]);
});

test('higher priority preempts lower priority on shared channels only', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const mine = s.enqueue(hold('mine', ['hands', 'head'], 100), { priority: 0 });
  const walk = s.enqueue(hold('walk', ['legs'], 100), { priority: 0 });
  run(s, 2);
  const flee = s.enqueue(hold('flee', ['legs', 'head'], 5), { priority: 10 });
  run(s, 1);
  assert.equal(flee.state, 'running');
  assert.equal(mine.state, 'cancelled');
  assert.equal(walk.state, 'cancelled');
  assert.match(mine.result!, /preempted by/);
  assert.ok(ctx.log.includes('end mine'), 'preempted action released its controls');
});

test('non-preemptible or equal priority blockers are not preempted', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const craft = s.enqueue(hold('craft', ['inventory'], 50), { priority: 0, preemptible: false });
  run(s, 1);
  const same = s.enqueue(hold('sort', ['inventory'], 5), { priority: 0 });
  const urgent = s.enqueue(hold('urgent', ['inventory'], 5), { priority: 9 });
  run(s, 5);
  assert.equal(craft.state, 'running');
  assert.equal(same.state, 'queued');
  assert.equal(urgent.state, 'queued');
});

test('timeouts fail the action and release controls', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const r = s.enqueue(hold('forever', ['legs'], Infinity, { timeoutTicks: 10 }));
  run(s, 20);
  assert.equal(r.state, 'failed');
  assert.match(r.result!, /timeout/);
  assert.ok(ctx.log.includes('end forever'));
});

test('stall watchdog kills actions that stop making progress (the infinite-jump bug)', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  // Moves for 5 ticks, then "jumps against a wall" forever without getting closer.
  let t = 0;
  const r = s.enqueue({
    name: 'goto', channels: ['legs'], stallTicks: 20, minProgress: 0.1,
    tick: c => { if (t++ < 5) c.pos += 1; return RUNNING; },
    progress: c => c.pos,
  });
  run(s, 100);
  assert.equal(r.state, 'failed');
  assert.match(r.result!, /stalled/);
  assert.ok(r.endedTick! < 40);
});

test('an action that throws fails cleanly and does not break the loop', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const bad = s.enqueue({ name: 'bad', channels: ['hands'], tick: () => { throw new Error('boom'); } });
  const good = s.enqueue(hold('good', ['legs'], 3));
  run(s, 5);
  assert.equal(bad.state, 'failed');
  assert.match(bad.result!, /boom/);
  assert.equal(good.state, 'done');
});

test('start() may finish or fail immediately', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const ok = s.enqueue({ name: 'instant', channels: ['hands'], start: () => done('instant'), tick: () => RUNNING });
  const no = s.enqueue({ name: 'nope', channels: ['legs'], start: () => failed('out of reach'), tick: () => RUNNING });
  run(s, 1);
  assert.equal(ok.state, 'done');
  assert.equal(no.state, 'failed');
  assert.equal(no.result, 'out of reach');
  assert.deepEqual(s.snapshot().busy, { legs: null, head: null, hands: null, inventory: null, chat: null });
});

test('replace cancels whatever holds or waits on the same channels', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  const a = s.enqueue(hold('walkNorth', ['legs'], 100));
  run(s, 1);
  const b = s.enqueue(hold('walkSouth', ['legs'], 100), { replace: true });
  run(s, 1);
  assert.equal(a.state, 'cancelled');
  assert.equal(b.state, 'running');
});

test('queue TTL drops actions that waited too long', () => {
  const ctx: Ctx = { log: [], pos: 0 };
  const s = new ActionScheduler(cfg(), ctx);
  s.enqueue(hold('long', ['hands'], 100));
  const stale = s.enqueue(hold('stale', ['hands'], 1), { queueTtlTicks: 5 });
  run(s, 10);
  assert.equal(stale.state, 'cancelled');
  assert.match(stale.result!, /expired/);
});
