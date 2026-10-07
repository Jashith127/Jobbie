/**
 * Turn game state into a compact text observation for the LLM.
 *
 * Fair-play rule: with limits.onlyExposedBlocks, only blocks touching air (or
 * another transparent block) are reported, so the agent can't see ores buried
 * inside stone. A real player can't either.
 */
import type { Agent } from './agent.ts';
import { fmt } from './body.ts';

const BORING = new Set(['air', 'cave_air', 'void_air', 'bedrock']);

export function observe(agent: Agent, radius = 12): string {
  const { bot } = agent;
  const me = bot.entity.position;
  const lines: string[] = [];

  lines.push(
    `You: pos ${fmt(me)} health ${bot.health.toFixed(0)}/20 food ${bot.food}/20 ` +
      `facing yaw ${((bot.entity.yaw * 180) / Math.PI).toFixed(0)} pitch ${((bot.entity.pitch * 180) / Math.PI).toFixed(0)} ` +
      `${bot.entity.onGround ? 'on ground' : 'airborne'} | time ${bot.time.timeOfDay} (${bot.time.isDay ? 'day' : 'NIGHT'})`,
  );
  lines.push(`Holding: ${bot.heldItem ? `${bot.heldItem.name} x${bot.heldItem.count}` : 'nothing'}`);

  const inv = new Map<string, number>();
  for (const i of bot.inventory.items()) inv.set(i.name, (inv.get(i.name) ?? 0) + i.count);
  lines.push(`Inventory: ${inv.size ? [...inv].map(([n, c]) => `${n} x${c}`).join(', ') : 'empty'}`);

  const cursor = bot.blockAtCursor(agent.body.limits.reach);
  lines.push(`Crosshair: ${cursor ? `${cursor.name} at ${fmt(cursor.position)}` : 'nothing in reach'}`);

  // Blocks: group by type, give count + nearest few coordinates.
  const isTransparent = (b: any) => !b || b.transparent || b.boundingBox === 'empty';
  const positions = bot.findBlocks({
    point: me,
    maxDistance: radius,
    count: 4000,
    matching: (b: any) => !!b && !BORING.has(b.name),
  });
  const byType = new Map<string, { count: number; nearest: { d: number; p: string }[] }>();
  for (const p of positions) {
    const b = bot.blockAt(p);
    if (!b) continue;
    if (agent.body.limits.onlyExposedBlocks && !b.transparent) {
      const exposed = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) =>
        isTransparent(bot.blockAt(p.offset(x, y, z))),
      );
      if (!exposed) continue;
    }
    const e = byType.get(b.name) ?? { count: 0, nearest: [] };
    e.count++;
    const d = p.offset(0.5, 0.5, 0.5).distanceTo(me);
    e.nearest.push({ d, p: fmt(p) });
    byType.set(b.name, e);
  }
  const blockLines = [...byType]
    .sort((a, b) => a[1].count - b[1].count) // rare stuff first: more interesting
    .slice(0, 25)
    .map(([name, e]) => {
      e.nearest.sort((a, b) => a.d - b.d);
      return `  ${name} x${e.count} nearest ${e.nearest.slice(0, 3).map(n => `${n.p}@${n.d.toFixed(1)}`).join(' ')}`;
    });
  lines.push(`Visible blocks within ${radius} (rarest first):`, ...(blockLines.length ? blockLines : ['  none']));

  const ents = Object.values(bot.entities)
    .filter(e => e !== bot.entity && e.position.distanceTo(me) <= 24)
    .sort((a, b) => a.position.distanceTo(me) - b.position.distanceTo(me))
    .slice(0, 12)
    .map(e => {
      const label = e.type === 'player' ? `player ${e.username}` : e.name === 'item' ? `dropped item` : `${e.name}`;
      return `  id ${e.id} ${label} at ${fmt(e.position)} dist ${e.position.distanceTo(me).toFixed(1)}`;
    });
  lines.push('Entities within 24:', ...(ents.length ? ents : ['  none']));

  const snap = agent.scheduler.snapshot();
  const busy = Object.entries(snap.busy).map(([c, id]) => `${c}:${id === null ? 'free' : `#${id}`}`).join(' ');
  lines.push(`Body channels: ${busy}`);
  if (snap.running.length) lines.push('Running:', ...snap.running.map(r => `  ${agent.describeRecord(r)}`));
  if (snap.queued.length) lines.push('Queued:', ...snap.queued.map(r => `  ${agent.describeRecord(r)}`));
  return lines.join('\n');
}
