/**
 * End-to-end tests against a real (pure-JS, offline) Minecraft server.
 * No LLM involved: these exercise the body + scheduler on actual game physics.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Agent } from '../src/agent.ts';
import { SPEED_PRESETS } from '../src/scheduler.ts';
import { observe } from '../src/observe.ts';
import { Brain } from '../src/brain.ts';

const require = createRequire(import.meta.url);
const { start } = require('../scripts/test-server.cjs');
const PORT = 25600 + Math.floor(Math.random() * 300);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let server: any;
let agent: Agent;
let n = 0;

/** Fresh flat area per test, far from the others. Admin commands are test setup only — the agent itself can't use them. */
async function arena() {
  const x = 1000 + 40 * n++;
  agent.scheduler.cancelAll('arena reset');
  agent.bot.chat(`/tp ${agent.bot.username} ${x} 5 0`);
  for (let i = 0; i < 40; i++) {
    await sleep(100);
    if (Math.abs(agent.bot.entity.position.x - x) < 1 && agent.bot.entity.onGround && agent.bot.blockAt(agent.bot.entity.position.offset(0, -1, 0))) break;
  }
  await sleep(500);
  return agent.bot.entity.position.floored();
}

const setblock = async (x: number, y: number, z: number, block: string) => {
  agent.bot.chat(`/setblock ${x} ${y} ${z} ${block}`);
  await sleep(250);
};

before(async () => {
  server = start({ port: PORT });
  await sleep(1500);
  agent = await Agent.connect({ host: '127.0.0.1', port: PORT, username: 'e2e', speed: SPEED_PRESETS.fast, reflexes: false });
  await sleep(1000);
});

after(() => {
  agent?.quit();
  server?.quit?.();
  setTimeout(() => process.exit(0), 200).unref();
});

test('walks one way while looking another, at the same time', async () => {
  const p = await arena();
  const walk = agent.do('move_toward', { x: p.x + 6.5, z: p.z + 0.5 });
  const look = agent.do('look_at', { x: p.x - 20, y: p.y + 1, z: p.z + 0.5, track_ticks: 20 });
  await agent.waitFor([walk.id, look.id], 10_000);
  assert.equal(walk.state, 'done', String(walk.result));
  assert.equal(look.state, 'done', String(look.result));
  // Overlapping lifetimes = real parallelism.
  assert.ok(walk.startedTick! < look.endedTick! && look.startedTick! < walk.endedTick!);
  assert.ok(agent.bot.entity.position.x > p.x + 5.5, 'moved east');
  // Facing west (yaw ~ +90deg) while having walked east.
  const yawDeg = (agent.bot.entity.yaw * 180) / Math.PI;
  assert.ok(Math.abs(yawDeg - 90) < 10, `yaw ${yawDeg}`);
});

test('mines and places within reach, through the crosshair', async () => {
  const p = await arena();
  agent.bot.chat(`/give e2e dirt 4`);
  await sleep(400);
  const m = agent.do('mine', { x: p.x + 1, y: p.y - 1, z: p.z });
  const pl = agent.do('place', { x: p.x + 2, y: p.y, z: p.z, item: 'dirt' });
  await agent.waitFor([m.id, pl.id], 10_000);
  assert.equal(m.state, 'done', String(m.result));
  assert.equal(pl.state, 'done', String(pl.result));
  assert.equal(agent.bot.blockAt(p.offset(1, -1, 0))?.name, 'air');
  assert.equal(agent.bot.blockAt(p.offset(2, 0, 0))?.name, 'dirt');
  // Hands were shared, so these two were serialized, not parallel.
  assert.ok(pl.startedTick! >= m.endedTick!);
});

test('cannot mine through walls (no x-ray, no reach hacks)', async () => {
  const p = await arena();
  const hidden = agent.do('mine', { x: p.x + 1, y: p.y - 2, z: p.z }); // dirt under the grass
  const far = agent.do('mine', { x: p.x + 9, y: p.y - 1, z: p.z });
  await agent.waitFor([hidden.id, far.id], 10_000);
  assert.equal(hidden.state, 'failed');
  assert.match(hidden.result!, /line of sight blocked/);
  assert.equal(far.state, 'failed');
  assert.match(far.result!, /out of reach/);
  const visible = observe(agent).split('Visible blocks')[1].split('Entities')[0];
  assert.doesNotMatch(visible, /\bdirt\b/, 'buried dirt is not reported');
});

test('watchdog stops an agent stuck against a wall instead of jumping forever', async () => {
  const p = await arena();
  for (let dz = -2; dz <= 2; dz++) {
    await setblock(p.x + 2, p.y, p.z + dz, 'stone');
    await setblock(p.x + 2, p.y + 1, p.z + dz, 'stone');
  }
  const walk = agent.do('move_toward', { x: p.x + 8.5, z: p.z + 0.5 });
  await agent.waitFor([walk.id], 10_000);
  assert.equal(walk.state, 'failed');
  assert.match(walk.result!, /stalled/);
  assert.ok(walk.endedTick! - walk.startedTick! < 80);
  assert.equal(agent.bot.getControlState('jump'), false, 'controls released');
  assert.equal(agent.bot.getControlState('forward') || agent.bot.getControlState('back'), false);
});

test('pathfinder goto reaches a target around an obstacle', async () => {
  const p = await arena();
  for (let dz = -1; dz <= 1; dz++) {
    await setblock(p.x + 2, p.y, p.z + dz, 'stone');
    await setblock(p.x + 2, p.y + 1, p.z + dz, 'stone');
  }
  const g = agent.do('goto', { x: p.x + 5, y: p.y, z: p.z, range: 1 });
  await agent.waitFor([g.id], 15_000);
  assert.equal(g.state, 'done', String(g.result));
  assert.ok(agent.bot.entity.position.distanceTo(p.offset(5, 0, 0)) < 2);
});

test('a higher-priority action preempts a lower one on shared channels only', async () => {
  const p = await arena();
  const walk = agent.do('move_toward', { x: p.x + 0.5, z: p.z + 15.5 }, { priority: 0 });
  const look = agent.do('look_at', { x: p.x, y: p.y + 1, z: p.z - 10, track_ticks: 200 }, { priority: 0 });
  await sleep(300);
  const urgent = agent.do('hold_keys', { ticks: 10, back: true }, { priority: 10 });
  await agent.waitFor([urgent.id], 5_000);
  assert.equal(urgent.state, 'done');
  assert.equal(walk.state, 'cancelled');
  assert.match(walk.result!, /preempted/);
  assert.equal(look.state, 'running', 'head was not needed, so look_at kept going');
  agent.scheduler.cancel(look.id);
});

test('brain: parallel tool calls from Claude become concurrent actions', async () => {
  const p = await arena();
  // Scripted stand-in for the API (no key needed): first response issues three
  // tool calls at once, second inspects what came back.
  const requests: any[] = [];
  const replies = [
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'move_toward', input: { x: p.x + 5.5, z: p.z + 0.5 } },
        { type: 'tool_use', id: 't2', name: 'look_at', input: { x: p.x - 10, y: p.y, z: p.z, track_ticks: 10 } },
        { type: 'tool_use', id: 't3', name: 'wait', input: { seconds: 8 } },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] },
  ];
  const client = { beta: { messages: { create: async (req: any) => { requests.push(structuredClone(req)); return replies.shift(); } } } };
  const brain = new Brain(agent, { goal: 'test', client: client as any, maxTurns: 2, log: () => {} });
  await brain.run();

  const tools = requests[0].tools.map((t: any) => t.name);
  assert.ok(tools.includes('move_toward') && tools.includes('wait'));
  assert.equal(requests[0].model, 'claude-opus-5-5');
  // Second request: all three tool results in ONE user message, plus events.
  const last = requests[1].messages.at(-1);
  assert.equal(last.role, 'user');
  const results = last.content.filter((b: any) => b.type === 'tool_result');
  assert.deepEqual(results.map((r: any) => r.tool_use_id), ['t1', 't2', 't3']);
  assert.match(results[2].content, /move_toward.*done/);
  assert.match(results[2].content, /look_at.*done/);
  const [walk, look] = [...agent.scheduler.snapshot().recent].filter(r => /move_toward|look_at/.test(r.action.name)).slice(-2);
  assert.ok(walk.startedTick! < look.endedTick! && look.startedTick! < walk.endedTick!, 'ran concurrently');
  assert.ok(agent.bot.entity.position.x > p.x + 4.5);
});
