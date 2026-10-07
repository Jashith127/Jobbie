/**
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx src/main.ts --host localhost --port 25565 \
 *     --speed human --goal "Get a stone pickaxe"
 *
 * --speed human|fast|superhuman, or --decision-ticks N --max-starts N for a custom reaction rate.
 * --head-speed DEG  max head rotation per tick (default 30; 180 = instant).
 */
import { parseArgs } from 'node:util';
import { Agent } from './agent.ts';
import { Brain } from './brain.ts';
import { SPEED_PRESETS } from './scheduler.ts';

const { values: a } = parseArgs({
  options: {
    host: { type: 'string', default: 'localhost' },
    port: { type: 'string', default: '25565' },
    username: { type: 'string', default: 'Claude' },
    version: { type: 'string' },
    goal: { type: 'string', default: 'Gather wood, craft a wooden pickaxe, then get a stone pickaxe.' },
    speed: { type: 'string', default: 'human' },
    'decision-ticks': { type: 'string' },
    'max-starts': { type: 'string' },
    'head-speed': { type: 'string' },
    effort: { type: 'string', default: 'low' },
    model: { type: 'string', default: 'claude-opus-5-5' },
    'max-turns': { type: 'string', default: '200' },
  },
});

const preset = SPEED_PRESETS[a.speed!];
if (!preset) throw new Error(`unknown --speed ${a.speed}; use ${Object.keys(SPEED_PRESETS).join('|')}`);
const speed = {
  ...preset,
  ...(a['decision-ticks'] ? { decisionIntervalTicks: Number(a['decision-ticks']) } : {}),
  ...(a['max-starts'] ? { maxStartsPerDecision: Number(a['max-starts']) } : {}),
};

const agent = await Agent.connect({
  host: a.host!,
  port: Number(a.port),
  username: a.username!,
  version: a.version,
  speed,
  limits: a['head-speed'] ? { headDegPerTick: Number(a['head-speed']) } : {},
});
console.log(`spawned at ${agent.where()} | admit every ${speed.decisionIntervalTicks} ticks, ${speed.maxStartsPerDecision} starts/window`);

const brain = new Brain(agent, {
  goal: a.goal!,
  model: a.model,
  effort: a.effort as any,
  maxTurns: Number(a['max-turns']),
});
process.on('SIGINT', () => { brain.stop(); agent.quit(); process.exit(0); });
await brain.run();
agent.quit();
