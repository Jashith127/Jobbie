/**
 * The agent's abilities: only what a real player can do with keyboard + mouse.
 *
 * No /tp, no /give, no reaching through walls, no instant head snaps (unless
 * the limits say so). Each ability is a tick-stepped Action that declares the
 * body channels it occupies, so the scheduler can run compatible abilities at
 * the same time (walk + look + eat) and serialize conflicting ones.
 */
import type { Entity } from 'prismarine-entity';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { type Action, type Channel, RUNNING, done, failed } from './scheduler.ts';
import { type Body, Pending, fmt, releaseLegs, turnHeadToward, v, wasdToward } from './body.ts';

const { goals, Movements } = pathfinderPkg;

type Args = Record<string, any>;

export interface ActionSpec {
  name: string;
  description: string;
  channels: readonly Channel[];
  /** JSON Schema `properties` for the tool input. */
  properties: Record<string, unknown>;
  required: string[];
  build(args: Args, body: Body): Action<Body>;
}

const num = { type: 'number' };
const int = { type: 'integer' };
const xyz = { x: num, y: num, z: num };

function itemByName(body: Body, name: string) {
  return body.bot.inventory.items().find(i => i.name === name) ?? null;
}

function findEntity(body: Body, id: number): Entity | null {
  const e = body.bot.entities[id];
  return e && e.isValid !== false ? e : null;
}

// ---------------------------------------------------------------------------

const moveToward: ActionSpec = {
  name: 'move_toward',
  description:
    'Walk in a straight line toward (x,z) using WASD relative to wherever the head is currently facing, auto-jumping 1-block steps. ' +
    'Uses LEGS only, so you can look at / mine / attack something else at the same time (strafing). No pathfinding: use goto for complex routes.',
  channels: ['legs'],
  properties: { x: num, z: num, range: { ...num, description: 'stop within this horizontal distance (default 0.6)' }, sprint: { type: 'boolean' } },
  required: ['x', 'z'],
  build: (a, body) => {
    const target = v(a.x, 0, a.z);
    const range = a.range ?? 0.6;
    const hdist = () => {
      const p = body.bot.entity.position;
      return Math.hypot(p.x - target.x, p.z - target.z);
    };
    return {
      name: `move_toward(${a.x},${a.z})`,
      channels: moveToward.channels,
      timeoutTicks: 20 * 60,
      stallTicks: 40,
      minProgress: 0.2,
      progress: () => -hdist(),
      tick: ({ bot }) => {
        if (hdist() <= range) return done(`arrived at ${fmt(bot.entity.position)}`);
        const keys = wasdToward(bot, v(target.x, bot.entity.position.y, target.z));
        for (const [k, on] of Object.entries(keys)) bot.setControlState(k as any, on);
        bot.setControlState('sprint', !!a.sprint && keys.forward);
        bot.setControlState('jump', (bot.entity as any).isCollidedHorizontally && bot.entity.onGround);
        return RUNNING;
      },
      end: ({ bot }) => releaseLegs(bot),
    };
  },
};

const goTo: ActionSpec = {
  name: 'goto',
  description:
    'Pathfind to within `range` blocks of (x,y,z), climbing/descending/jumping gaps. Never breaks or places blocks. ' +
    'Uses LEGS and HEAD (it faces where it walks). Fails fast if no path or if stuck.',
  channels: ['legs', 'head'],
  properties: { ...xyz, range: { ...num, description: 'default 1' } },
  required: ['x', 'y', 'z'],
  build: (a, body) => {
    const range = a.range ?? 1;
    const goal = new goals.GoalNear(a.x, a.y, a.z, range);
    let noPath = false;
    const onPath = (r: { status: string }) => { if (r.status === 'noPath' || r.status === 'timeout') noPath = true; };
    const dist = () => body.bot.entity.position.distanceTo(v(a.x, a.y, a.z));
    return {
      name: `goto(${a.x},${a.y},${a.z})`,
      channels: goTo.channels,
      timeoutTicks: 20 * 120,
      stallTicks: 60,
      minProgress: 0.3,
      progress: () => -dist(),
      start: ({ bot }) => {
        const moves = new Movements(bot);
        moves.canDig = false; // digging is a hands action; ask for it explicitly
        moves.allow1by1towers = false; // no surprise block placement
        moves.allowParkour = true;
        bot.pathfinder.setMovements(moves);
        bot.on('path_update', onPath);
        bot.pathfinder.setGoal(goal);
      },
      tick: ({ bot }) => {
        if (goal.isEnd(bot.entity.position.floored() as any)) return done(`arrived at ${fmt(bot.entity.position)}`);
        if (noPath) return failed(`no path to ${fmt(v(a.x, a.y, a.z))} (would need digging/building?)`);
        return RUNNING;
      },
      end: ({ bot }) => {
        bot.removeListener('path_update', onPath);
        bot.pathfinder.setGoal(null);
        releaseLegs(bot);
      },
    };
  },
};

const lookAt: ActionSpec = {
  name: 'look_at',
  description:
    'Turn the head toward a point or an entity at human turn speed. With track_ticks, keep tracking (e.g. watch a mob while walking). Uses HEAD only.',
  channels: ['head'],
  properties: { ...xyz, entity_id: int, track_ticks: { ...int, description: 'keep tracking for this many ticks (20/s)' } },
  required: [],
  build: (a, body) => {
    const point = (): Vec3 | null => {
      if (a.entity_id !== undefined) {
        const e = findEntity(body, a.entity_id);
        return e ? e.position.offset(0, e.height * 0.85, 0) : null;
      }
      return a.x !== undefined ? v(a.x, a.y, a.z) : null;
    };
    let t = 0;
    return {
      name: a.entity_id !== undefined ? `look_at(entity ${a.entity_id})` : `look_at(${a.x},${a.y},${a.z})`,
      channels: lookAt.channels,
      timeoutTicks: (a.track_ticks ?? 0) + 100,
      tick: b => {
        const p = point();
        if (!p) return failed('target not visible / gone');
        const aimed = turnHeadToward(b, p);
        t++;
        if (aimed && t >= (a.track_ticks ?? 0)) return done();
        return RUNNING;
      },
    };
  },
};

const mine: ActionSpec = {
  name: 'mine',
  description:
    'Aim at and break the block at (x,y,z). Must be within reach (4.5) AND be the first block your crosshair hits (no mining through walls). ' +
    'Uses HEAD and HANDS; legs stay free. Equip the right tool first. Drops must then be walked over (pickup).',
  channels: ['head', 'hands'],
  properties: xyz,
  required: ['x', 'y', 'z'],
  build: (a, body) => {
    const pos = v(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
    const center = pos.offset(0.5, 0.5, 0.5);
    const dig = new Pending();
    let name = '?';
    return {
      name: `mine${fmt(pos)}`,
      channels: mine.channels,
      timeoutTicks: 20 * 30,
      start: ({ bot }) => {
        const b = bot.blockAt(pos);
        if (!b || b.name === 'air' || b.name === 'cave_air') return failed(`nothing to mine at ${fmt(pos)}`);
        if (b.diggable === false) return failed(`${b.name} is unbreakable`);
        name = b.name;
      },
      tick: b => {
        const { bot, limits } = b;
        if (dig.state === 'ok') return done(`broke ${name}`);
        if (dig.state === 'error') return failed(`dig interrupted: ${dig.error}`);
        if (dig.state === 'running') {
          const cur = bot.blockAt(pos);
          if (!cur || cur.name !== name) return done(`broke ${name}`);
          return RUNNING;
        }
        if (bot.entity.position.offset(0, 1.6, 0).distanceTo(center) > limits.reach + 0.5) {
          return failed(`out of reach (${bot.entity.position.distanceTo(center).toFixed(1)} blocks); move closer first`);
        }
        if (!turnHeadToward(b, center)) return RUNNING;
        const hit = bot.blockAtCursor(limits.reach);
        if (!hit || !hit.position.equals(pos)) {
          return failed(`line of sight blocked by ${hit ? `${hit.name} at ${fmt(hit.position)}` : 'nothing (too far)'}`);
        }
        const target = bot.blockAt(pos)!;
        dig.run(() => bot.dig(target, 'ignore'));
        return RUNNING;
      },
      end: ({ bot }) => {
        if (dig.state === 'running') bot.stopDigging();
        dig.abandon();
      },
    };
  },
};

const FACES = [v(0, -1, 0), v(0, 1, 0), v(1, 0, 0), v(-1, 0, 0), v(0, 0, 1), v(0, 0, -1)];

const place: ActionSpec = {
  name: 'place',
  description:
    'Place `item` (a block from inventory) at the empty spot (x,y,z), against an adjacent solid block. Must be in reach. Uses HEAD and HANDS.',
  channels: ['head', 'hands'],
  properties: { ...xyz, item: { type: 'string' } },
  required: ['x', 'y', 'z', 'item'],
  build: (a, body) => {
    const pos = v(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z));
    const job = new Pending();
    let ref: { block: any; face: Vec3; aim: Vec3 } | null = null;
    return {
      name: `place(${a.item}@${fmt(pos)})`,
      channels: place.channels,
      timeoutTicks: 20 * 10,
      start: ({ bot }) => {
        const here = bot.blockAt(pos);
        if (here && here.boundingBox !== 'empty') return failed(`${fmt(pos)} is occupied by ${here.name}`);
        const item = itemByName(body, a.item);
        if (!item) return failed(`no ${a.item} in inventory`);
        for (const f of FACES) {
          const rb = bot.blockAt(pos.plus(f));
          if (rb && rb.boundingBox === 'block') {
            const face = f.scaled(-1);
            ref = { block: rb, face, aim: rb.position.offset(0.5, 0.5, 0.5).plus(face.scaled(0.5)) };
            break;
          }
        }
        if (!ref) return failed(`nothing solid next to ${fmt(pos)} to place against`);
      },
      tick: b => {
        const { bot, limits } = b;
        if (job.state === 'ok') return done(`placed ${a.item}`);
        if (job.state === 'error') return failed(job.error ?? 'place failed');
        if (job.state === 'running') return RUNNING;
        if (bot.entity.position.offset(0, 1.6, 0).distanceTo(ref!.aim) > limits.reach) return failed('out of reach; move closer first');
        if (!turnHeadToward(b, ref!.aim)) return RUNNING;
        const item = itemByName(b, a.item);
        if (!item) return failed(`no ${a.item} in inventory`);
        job.run(async () => {
          if (bot.heldItem?.name !== a.item) await bot.equip(item, 'hand');
          await bot.placeBlock(ref!.block, ref!.face);
        });
        return RUNNING;
      },
      end: () => job.abandon(),
    };
  },
};

const attack: ActionSpec = {
  name: 'attack',
  description:
    'Swing at entity `entity_id` up to `hits` times, waiting for the weapon cooldown between swings. Only hits when aimed and within 3 blocks — ' +
    'combine with move_toward (legs) to chase or kite. Uses HEAD and HANDS.',
  channels: ['head', 'hands'],
  properties: { entity_id: int, hits: { ...int, description: 'default 1' }, cooldown_ticks: { ...int, description: 'default 12 (full sword charge)' } },
  required: ['entity_id'],
  build: (a, body) => {
    const hits = a.hits ?? 1;
    const cooldown = a.cooldown_ticks ?? 12;
    let landed = 0;
    let lastSwing = -Infinity;
    let t = 0;
    return {
      name: `attack(entity ${a.entity_id} x${hits})`,
      channels: attack.channels,
      timeoutTicks: 20 * 30,
      tick: b => {
        t++;
        const e = findEntity(b, a.entity_id);
        if (!e) return landed ? done(`target gone after ${landed} hits`) : failed('target not found');
        const aimAt = e.position.offset(0, e.height * 0.6, 0);
        const aimed = turnHeadToward(b, aimAt, 8);
        const dist = b.bot.entity.position.offset(0, 1.6, 0).distanceTo(aimAt);
        if (aimed && dist <= b.limits.attackReach + 0.5 && t - lastSwing >= cooldown) {
          b.bot.attack(e);
          lastSwing = t;
          if (++landed >= hits) return done(`landed ${landed} hits`);
        }
        return RUNNING;
      },
    };
  },
};

const eat: ActionSpec = {
  name: 'eat',
  description: 'Eat `item` (or any food if omitted). Takes ~1.6s. Uses HANDS only, so you can keep walking and looking around.',
  channels: ['hands'],
  properties: { item: { type: 'string' } },
  required: [],
  build: (a, body) => {
    const job = new Pending();
    return {
      name: `eat(${a.item ?? 'any'})`,
      channels: eat.channels,
      timeoutTicks: 20 * 6,
      start: ({ bot }) => {
        const foods = bot.registry.foodsByName;
        const item = a.item ? itemByName(body, a.item) : bot.inventory.items().find(i => foods[i.name]);
        if (!item) return failed(a.item ? `no ${a.item}` : 'no food in inventory');
        if (bot.food >= 20) return failed('not hungry (food is full)');
        job.run(async () => {
          await bot.equip(item, 'hand');
          await bot.consume();
        });
      },
      tick: () => (job.state === 'ok' ? done('ate') : job.state === 'error' ? failed(job.error!) : RUNNING),
      end: ({ bot }) => {
        if (job.state === 'running') bot.deactivateItem();
        job.abandon();
      },
    };
  },
};

const equip: ActionSpec = {
  name: 'equip',
  description: 'Move an item to hand / off-hand / armor slot. Uses INVENTORY.',
  channels: ['inventory'],
  properties: { item: { type: 'string' }, slot: { type: 'string', enum: ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'] } },
  required: ['item'],
  build: (a, body) => {
    const job = new Pending();
    return {
      name: `equip(${a.item})`,
      channels: equip.channels,
      timeoutTicks: 20 * 5,
      start: ({ bot }) => {
        const item = itemByName(body, a.item);
        if (!item) return failed(`no ${a.item} in inventory`);
        job.run(() => bot.equip(item, a.slot ?? 'hand'));
      },
      tick: () => (job.state === 'ok' ? done() : job.state === 'error' ? failed(job.error!) : RUNNING),
      end: () => job.abandon(),
    };
  },
};

const craft: ActionSpec = {
  name: 'craft',
  description:
    'Craft `count` x `item`. 2x2 recipes work anywhere; 3x3 recipes need a crafting_table within reach. Uses INVENTORY and HANDS.',
  channels: ['inventory', 'hands'],
  properties: { item: { type: 'string' }, count: { ...int, description: 'default 1' } },
  required: ['item'],
  build: (a, body) => {
    const job = new Pending();
    return {
      name: `craft(${a.count ?? 1}x ${a.item})`,
      channels: craft.channels,
      timeoutTicks: 20 * 20,
      start: ({ bot, limits }) => {
        const def = bot.registry.itemsByName[a.item];
        if (!def) return failed(`unknown item ${a.item}`);
        const table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: limits.reach }) ?? null;
        const recipes = bot.recipesFor(def.id, null, 1, table);
        if (!recipes.length) {
          const any = bot.recipesAll(def.id, null, true).length > 0;
          return failed(any && !table ? 'needs a crafting_table within reach' : `missing ingredients for ${a.item}`);
        }
        job.run(() => bot.craft(recipes[0], a.count ?? 1, table ?? undefined));
      },
      tick: () => (job.state === 'ok' ? done(`crafted ${a.item}`) : job.state === 'error' ? failed(job.error!) : RUNNING),
      end: () => job.abandon(),
    };
  },
};

const pickup: ActionSpec = {
  name: 'pickup',
  description: 'Walk over dropped items within `radius` (default 6) to collect them. Uses LEGS only.',
  channels: ['legs'],
  properties: { radius: num },
  required: [],
  build: (a, body) => {
    const radius = a.radius ?? 6;
    let collected = 0;
    let target: Entity | null = null;
    const nearestDrop = () =>
      body.bot.nearestEntity(e => e.name === 'item' && e.position.distanceTo(body.bot.entity.position) <= radius);
    return {
      name: `pickup(r=${radius})`,
      channels: pickup.channels,
      timeoutTicks: 20 * 30,
      tick: ({ bot }) => {
        if (target && !findEntity(body, target.id)) { collected++; target = null; }
        target ??= nearestDrop();
        if (!target) return collected ? done(`picked up ${collected} stacks`) : done('no drops nearby');
        const keys = wasdToward(bot, target.position);
        for (const [k, on] of Object.entries(keys)) bot.setControlState(k as any, on);
        bot.setControlState('jump', (bot.entity as any).isCollidedHorizontally && bot.entity.onGround);
        return RUNNING;
      },
      end: ({ bot }) => releaseLegs(bot),
    };
  },
};

const holdKeys: ActionSpec = {
  name: 'hold_keys',
  description: 'Raw keyboard: hold movement keys for `ticks` (20/s). E.g. jump in place, sneak at an edge, sprint-jump. Uses LEGS.',
  channels: ['legs'],
  properties: {
    ticks: int,
    forward: { type: 'boolean' }, back: { type: 'boolean' }, left: { type: 'boolean' }, right: { type: 'boolean' },
    jump: { type: 'boolean' }, sprint: { type: 'boolean' }, sneak: { type: 'boolean' },
  },
  required: ['ticks'],
  build: a => {
    let t = 0;
    const keys = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'] as const;
    return {
      name: `hold_keys(${keys.filter(k => a[k]).join('+') || 'none'} for ${a.ticks})`,
      channels: holdKeys.channels,
      timeoutTicks: a.ticks + 5,
      start: ({ bot }) => { for (const k of keys) bot.setControlState(k, !!a[k]); },
      tick: () => (++t >= a.ticks ? done() : RUNNING),
      end: ({ bot }) => releaseLegs(bot),
    };
  },
};

const toss: ActionSpec = {
  name: 'toss',
  description: 'Drop `count` of `item` on the ground in front of you. Uses INVENTORY.',
  channels: ['inventory'],
  properties: { item: { type: 'string' }, count: int },
  required: ['item'],
  build: (a, body) => {
    const job = new Pending();
    return {
      name: `toss(${a.item})`,
      channels: toss.channels,
      timeoutTicks: 20 * 5,
      start: ({ bot }) => {
        const item = itemByName(body, a.item);
        if (!item) return failed(`no ${a.item}`);
        job.run(() => bot.toss(item.type, null, a.count ?? item.count));
      },
      tick: () => (job.state === 'ok' ? done() : job.state === 'error' ? failed(job.error!) : RUNNING),
      end: () => job.abandon(),
    };
  },
};

const chat: ActionSpec = {
  name: 'chat',
  description: 'Say something in public chat. Uses CHAT.',
  channels: ['chat'],
  properties: { message: { type: 'string' } },
  required: ['message'],
  build: a => ({
    name: 'chat',
    channels: chat.channels,
    start: ({ bot }) => {
      // Commands would be cheating; a real survival player can't /give or /tp.
      if (String(a.message).startsWith('/')) return failed('slash commands are not allowed');
      bot.chat(String(a.message).slice(0, 256));
      return done();
    },
    tick: () => done(),
  }),
};

export const ACTIONS: ActionSpec[] = [moveToward, goTo, lookAt, mine, place, attack, eat, equip, craft, pickup, holdKeys, toss, chat];
export const ACTIONS_BY_NAME = new Map(ACTIONS.map(s => [s.name, s]));
