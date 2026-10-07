/**
 * Fast, deterministic reflexes that run every tick without asking the LLM.
 *
 * An LLM call takes seconds; Minecraft runs at 20 ticks per second. Anything
 * that must happen within a few hundred milliseconds (getting out of water
 * before drowning, eating before starving) belongs here. Reflexes go through
 * the same scheduler with high priority, so they preempt deliberate actions
 * on the channels they need and leave the other channels alone.
 */
import type { Agent } from './agent.ts';
import type { ActionRecord } from './scheduler.ts';
import type { Body } from './body.ts';

export class Reflexes {
  private active = new Map<string, ActionRecord<Body>>();

  constructor(private agent: Agent, public enabled: boolean) {}

  tick(): void {
    if (!this.enabled) return;
    const { bot } = this.agent;
    if (!bot.entity) return;

    // Drowning: swim up. Legs only, so mining/looking can continue.
    const air = (bot as any).oxygenLevel as number | undefined;
    if (air !== undefined && air < 12 && (bot.entity as any).isInWater) {
      this.fire('surface', 'hold_keys', { ticks: 20, jump: true }, 50);
    }

    // Hungry with food in pocket: eat. Hands only, so walking continues.
    const foods = bot.registry.foodsByName;
    if (bot.food <= 14 && bot.inventory.items().some(i => foods[i.name])) {
      this.fire('eat', 'eat', {}, 20);
    }
  }

  private fire(key: string, action: string, args: Record<string, unknown>, priority: number): void {
    const cur = this.active.get(key);
    if (cur && (cur.state === 'queued' || cur.state === 'running')) return;
    // Don't retry a reflex that just failed, every tick.
    if (cur && cur.endedTick !== undefined && this.agent.scheduler.tick_ - cur.endedTick < 100 && cur.state === 'failed') return;
    const rec = this.agent.do(action, args, { priority, preemptible: false, queueTtlTicks: 40 });
    this.agent.log(`reflex: ${key} -> #${rec.id}`);
    this.active.set(key, rec);
  }
}
