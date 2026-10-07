import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Physical limits of the simulated player. Tune to make the agent more or less human. */
export interface BodyLimits {
  /** Max head rotation per tick, degrees. Humans flick ~20-40 deg/tick; 180 = instant snap. */
  headDegPerTick: number;
  /** Block interaction reach (vanilla survival: 4.5). */
  reach: number;
  /** Entity attack reach (vanilla: 3.0). */
  attackReach: number;
  /** Only report blocks that touch air/transparent blocks (no x-ray). */
  onlyExposedBlocks: boolean;
}

export const DEFAULT_LIMITS: BodyLimits = {
  headDegPerTick: 30,
  reach: 4.5,
  attackReach: 3.0,
  onlyExposedBlocks: true,
};

/** Context handed to every action. */
export interface Body {
  bot: Bot;
  limits: BodyLimits;
}

const TAU = Math.PI * 2;
export const wrapAngle = (a: number) => {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a;
};

export function eyePos(bot: Bot): Vec3 {
  return bot.entity.position.offset(0, bot.entity.height * 0.9, 0);
}

/** Same convention as mineflayer's bot.lookAt. */
export function yawPitchTo(bot: Bot, point: Vec3): { yaw: number; pitch: number } {
  const d = point.minus(eyePos(bot));
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.atan2(d.y, Math.sqrt(d.x * d.x + d.z * d.z));
  return { yaw, pitch };
}

/**
 * Rotate the head toward `point` by at most headDegPerTick this tick.
 * Returns true once aimed within `toleranceDeg`.
 */
export function turnHeadToward(body: Body, point: Vec3, toleranceDeg = 2): boolean {
  const { bot, limits } = body;
  const target = yawPitchTo(bot, point);
  const max = (limits.headDegPerTick * Math.PI) / 180;
  const dYaw = wrapAngle(target.yaw - bot.entity.yaw);
  const dPitch = target.pitch - bot.entity.pitch;
  const tol = (toleranceDeg * Math.PI) / 180;
  if (Math.abs(dYaw) <= tol && Math.abs(dPitch) <= tol) return true;
  const clamp = (v: number) => Math.max(-max, Math.min(max, v));
  void bot.look(bot.entity.yaw + clamp(dYaw), bot.entity.pitch + clamp(dPitch), true);
  return Math.abs(dYaw) <= max + tol && Math.abs(dPitch) <= max + tol;
}

const MOVE_KEYS = ['forward', 'back', 'left', 'right'] as const;

/**
 * Choose WASD keys that move the body toward `target` given the CURRENT head
 * yaw, without touching the head. This is what lets a player walk one way
 * while looking another (strafing, kiting mobs, mining while walking).
 */
export function wasdToward(bot: Bot, target: Vec3): Record<(typeof MOVE_KEYS)[number], boolean> {
  const p = bot.entity.position;
  const desiredYaw = Math.atan2(-(target.x - p.x), -(target.z - p.z));
  const rel = wrapAngle(desiredYaw - bot.entity.yaw);
  // 8 sectors of 45 degrees. rel=0 => forward, rel=+90 => left (mineflayer yaw is CCW-positive).
  const sector = Math.round(rel / (Math.PI / 4));
  const keys = { forward: false, back: false, left: false, right: false };
  switch (sector) {
    case 0: keys.forward = true; break;
    case 1: keys.forward = keys.left = true; break;
    case 2: keys.left = true; break;
    case 3: keys.back = keys.left = true; break;
    case 4: case -4: keys.back = true; break;
    case -3: keys.back = keys.right = true; break;
    case -2: keys.right = true; break;
    case -1: keys.forward = keys.right = true; break;
  }
  return keys;
}

export function releaseLegs(bot: Bot): void {
  for (const k of [...MOVE_KEYS, 'jump', 'sprint', 'sneak'] as const) bot.setControlState(k, false);
}

/**
 * Tracks a mineflayer promise from inside a tick-stepped action. The action
 * polls `state` each tick instead of awaiting, so a late resolution after the
 * action was cancelled is simply ignored rather than racing with whatever
 * owns the channel next.
 */
export class Pending {
  state: 'idle' | 'running' | 'ok' | 'error' = 'idle';
  error?: string;
  private generation = 0;

  run(p: () => Promise<unknown>): void {
    const gen = ++this.generation;
    this.state = 'running';
    let promise: Promise<unknown>;
    try {
      promise = p();
    } catch (e) {
      this.state = 'error';
      this.error = (e as Error).message;
      return;
    }
    promise.then(
      () => { if (gen === this.generation) this.state = 'ok'; },
      e => { if (gen === this.generation) { this.state = 'error'; this.error = (e as Error)?.message ?? String(e); } },
    );
  }

  /** Invalidate any in-flight promise. */
  abandon(): void {
    this.generation++;
    this.state = 'idle';
  }
}

export const v = (x: number, y: number, z: number) => new Vec3(x, y, z);
export const fmt = (p: Vec3) => `(${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)})`;
