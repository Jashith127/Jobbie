/**
 * Parallel action scheduler.
 *
 * A human player has a fixed set of "body channels" they can drive at the same
 * time: their legs (WASD/jump/sneak/sprint), their head (mouse look), their
 * hands (left/right click), their inventory (open windows, hotbar), and chat.
 * You can walk forward while looking around while eating, but you cannot mine
 * two blocks at once or look in two directions.
 *
 * This scheduler models exactly that:
 *   - Every action declares which channels it occupies.
 *   - Actions run concurrently as long as their channels don't overlap.
 *   - Actions are tick-stepped state machines driven from ONE loop, so there
 *     are no free-running promises fighting over the bot's control state
 *     (the main source of race conditions in promise-based bot skills).
 *   - New actions are admitted only every `decisionIntervalTicks`, with at most
 *     `maxStartsPerDecision` starts per window. Those two knobs are the
 *     "reaction speed" / APM dial: human-like at ~4 ticks / 1 start, superhuman
 *     at 1 tick / unlimited.
 *   - Higher priority actions can preempt lower priority ones holding the
 *     channels they need (e.g. a "flee lava" reflex preempts "mine stone").
 *   - Every action has a hard timeout and an optional no-progress watchdog, so
 *     nothing can loop forever (the infinite-jump pathfinder failure mode).
 *
 * The scheduler knows nothing about Minecraft; it is generic over a context
 * object `C` that actions receive. That keeps it unit-testable without a server.
 */

export type Channel = 'legs' | 'head' | 'hands' | 'inventory' | 'chat';
export const ALL_CHANNELS: readonly Channel[] = ['legs', 'head', 'hands', 'inventory', 'chat'];

export type StepResult =
  | { status: 'running' }
  | { status: 'done'; detail?: string }
  | { status: 'failed'; reason: string };

export const RUNNING: StepResult = { status: 'running' };
export const done = (detail?: string): StepResult => ({ status: 'done', detail });
export const failed = (reason: string): StepResult => ({ status: 'failed', reason });

export interface Action<C> {
  /** Human/LLM-readable name, e.g. "mine(10,4,3)". */
  readonly name: string;
  readonly channels: readonly Channel[];
  /** Called once when the action is admitted. May return a terminal result immediately. */
  start?(ctx: C): StepResult | void;
  /** Called every game tick while running. */
  tick(ctx: C): StepResult;
  /**
   * Called exactly once when the action stops for any reason (done, failed,
   * timeout, cancelled, preempted). Must release every control it holds.
   */
  end?(ctx: C): void;
  /** Ticks before the action fails with "timeout". */
  readonly timeoutTicks?: number;
  /**
   * Optional progress metric (e.g. negative distance to goal). If it does not
   * increase by at least `minProgress` within `stallTicks`, the action fails as
   * "stalled". Catches agents stuck jumping against a wall forever.
   */
  progress?(ctx: C): number;
  readonly stallTicks?: number;
  readonly minProgress?: number;
}

export type ActionState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ActionRecord<C> {
  id: number;
  action: Action<C>;
  priority: number;
  state: ActionState;
  enqueuedTick: number;
  startedTick?: number;
  endedTick?: number;
  result?: string;
  /** Whether a higher-priority action may cancel this one. */
  preemptible: boolean;
  /** Drop from the queue if it hasn't started within this many ticks. */
  queueTtlTicks?: number;
  // watchdog bookkeeping
  bestProgress?: number;
  lastProgressTick?: number;
}

export interface SchedulerConfig {
  /** Admit new actions only every N ticks (20 ticks = 1 second). */
  decisionIntervalTicks: number;
  /** Max actions started per decision window. Infinity = no cap. */
  maxStartsPerDecision: number;
  /** Default timeout if an action doesn't specify one. */
  defaultTimeoutTicks: number;
  /** Keep this many finished records for observation/feedback. */
  historySize: number;
}

export const SPEED_PRESETS: Record<string, SchedulerConfig> = {
  /** Roughly human: ~200ms reaction window, one new thing at a time. ~300 APM ceiling. */
  human: { decisionIntervalTicks: 4, maxStartsPerDecision: 1, defaultTimeoutTicks: 20 * 60, historySize: 50 },
  /** Skilled player / speedrunner-ish. */
  fast: { decisionIntervalTicks: 2, maxStartsPerDecision: 2, defaultTimeoutTicks: 20 * 60, historySize: 50 },
  /** Every tick, no cap. Still bounded by channels, so still "one body". */
  superhuman: { decisionIntervalTicks: 1, maxStartsPerDecision: Infinity, defaultTimeoutTicks: 20 * 60, historySize: 50 },
};

export interface EnqueueOptions {
  priority?: number;
  preemptible?: boolean;
  queueTtlTicks?: number;
  /** Cancel any queued/running action that shares a channel with this one. */
  replace?: boolean;
}

export type SchedulerEvent<C> = { type: 'started' | 'finished'; record: ActionRecord<C> };

export class ActionScheduler<C> {
  private nextId = 1;
  private tickCount = 0;
  private queue: ActionRecord<C>[] = [];
  private running = new Map<number, ActionRecord<C>>();
  private owners = new Map<Channel, number>();
  private history: ActionRecord<C>[] = [];
  private listeners: ((e: SchedulerEvent<C>) => void)[] = [];

  constructor(public config: SchedulerConfig, private ctx: C) {}

  get tick_(): number { return this.tickCount; }

  onEvent(fn: (e: SchedulerEvent<C>) => void): void { this.listeners.push(fn); }

  enqueue(action: Action<C>, opts: EnqueueOptions = {}): ActionRecord<C> {
    if (opts.replace) {
      for (const r of [...this.queue, ...this.running.values()]) {
        if (r.action.channels.some(c => action.channels.includes(c))) this.cancel(r.id, 'replaced');
      }
    }
    const rec: ActionRecord<C> = {
      id: this.nextId++,
      action,
      priority: opts.priority ?? 0,
      preemptible: opts.preemptible ?? true,
      queueTtlTicks: opts.queueTtlTicks,
      state: 'queued',
      enqueuedTick: this.tickCount,
    };
    this.queue.push(rec);
    return rec;
  }

  cancel(id: number, reason = 'cancelled'): boolean {
    const qi = this.queue.findIndex(r => r.id === id);
    if (qi >= 0) {
      const [rec] = this.queue.splice(qi, 1);
      this.finish(rec, 'cancelled', reason);
      return true;
    }
    const rec = this.running.get(id);
    if (!rec) return false;
    this.stop(rec, 'cancelled', reason);
    return true;
  }

  cancelAll(reason = 'cancelled'): void {
    for (const r of [...this.queue]) this.cancel(r.id, reason);
    for (const r of [...this.running.values()]) this.cancel(r.id, reason);
  }

  get(id: number): ActionRecord<C> | undefined {
    return this.queue.find(r => r.id === id) ?? this.running.get(id) ?? this.history.find(r => r.id === id);
  }

  snapshot() {
    return {
      tick: this.tickCount,
      running: [...this.running.values()],
      queued: [...this.queue],
      recent: [...this.history],
      busy: Object.fromEntries(ALL_CHANNELS.map(c => [c, this.owners.get(c) ?? null])) as Record<Channel, number | null>,
    };
  }

  /** Drive one game tick. Call from the bot's physics tick. */
  tick(): void {
    this.tickCount++;

    // 1. Step running actions. Done before admission so channels freed this
    //    tick can be reused in the same decision window.
    for (const rec of [...this.running.values()]) {
      if (!this.running.has(rec.id)) continue; // cancelled by an earlier action's step
      this.step(rec);
    }

    // 2. Expire stale queue entries.
    for (const rec of [...this.queue]) {
      if (rec.queueTtlTicks !== undefined && this.tickCount - rec.enqueuedTick > rec.queueTtlTicks) {
        this.cancel(rec.id, 'expired in queue');
      }
    }

    // 3. Admission, rate-limited by the speed config.
    if (this.tickCount % this.config.decisionIntervalTicks !== 0) return;
    let starts = 0;
    // Highest priority first; FIFO within a priority.
    const candidates = [...this.queue].sort((a, b) => b.priority - a.priority || a.id - b.id);
    for (const rec of candidates) {
      if (starts >= this.config.maxStartsPerDecision) break;
      if (!this.queue.includes(rec)) continue;
      const blockers = this.blockersOf(rec);
      if (blockers.length > 0) {
        const canPreempt = blockers.every(b => b.preemptible && b.priority < rec.priority);
        if (!canPreempt) continue;
        for (const b of blockers) this.stop(b, 'cancelled', `preempted by #${rec.id} ${rec.action.name}`);
      }
      this.queue.splice(this.queue.indexOf(rec), 1);
      this.begin(rec);
      starts++;
    }
  }

  private blockersOf(rec: ActionRecord<C>): ActionRecord<C>[] {
    const ids = new Set<number>();
    for (const c of rec.action.channels) {
      const owner = this.owners.get(c);
      if (owner !== undefined) ids.add(owner);
    }
    return [...ids].map(id => this.running.get(id)!).filter(Boolean);
  }

  private begin(rec: ActionRecord<C>): void {
    rec.state = 'running';
    rec.startedTick = this.tickCount;
    rec.lastProgressTick = this.tickCount;
    this.running.set(rec.id, rec);
    for (const c of rec.action.channels) this.owners.set(c, rec.id);
    this.emit({ type: 'started', record: rec });
    let res: StepResult | void;
    try {
      res = rec.action.start?.(this.ctx);
    } catch (e) {
      res = failed(`threw on start: ${(e as Error).message}`);
    }
    if (res && res.status !== 'running') this.settle(rec, res);
  }

  private step(rec: ActionRecord<C>): void {
    const a = rec.action;
    const age = this.tickCount - rec.startedTick!;
    const timeout = a.timeoutTicks ?? this.config.defaultTimeoutTicks;
    if (age > timeout) {
      this.stop(rec, 'failed', `timeout after ${timeout} ticks`);
      return;
    }
    let res: StepResult;
    try {
      res = a.tick(this.ctx);
    } catch (e) {
      res = failed(`threw: ${(e as Error).message}`);
    }
    if (res.status !== 'running') {
      this.settle(rec, res);
      return;
    }
    if (a.progress && a.stallTicks) {
      const p = a.progress(this.ctx);
      const min = a.minProgress ?? 0;
      if (rec.bestProgress === undefined || p > rec.bestProgress + min) {
        rec.bestProgress = p;
        rec.lastProgressTick = this.tickCount;
      } else if (this.tickCount - rec.lastProgressTick! > a.stallTicks) {
        this.stop(rec, 'failed', `stalled: no progress for ${a.stallTicks} ticks`);
      }
    }
  }

  /** Terminal result reported by the action itself. */
  private settle(rec: ActionRecord<C>, res: StepResult): void {
    if (res.status === 'done') this.stop(rec, 'done', res.detail ?? 'ok');
    else if (res.status === 'failed') this.stop(rec, 'failed', res.reason);
  }

  private stop(rec: ActionRecord<C>, state: ActionState, result: string): void {
    if (!this.running.has(rec.id)) return;
    this.running.delete(rec.id);
    for (const c of rec.action.channels) if (this.owners.get(c) === rec.id) this.owners.delete(c);
    try { rec.action.end?.(this.ctx); } catch { /* releasing must never throw */ }
    this.finish(rec, state, result);
  }

  private finish(rec: ActionRecord<C>, state: ActionState, result: string): void {
    rec.state = state;
    rec.result = result;
    rec.endedTick = this.tickCount;
    this.history.push(rec);
    if (this.history.length > this.config.historySize) this.history.shift();
    this.emit({ type: 'finished', record: rec });
  }

  private emit(e: SchedulerEvent<C>): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener bugs must not break the tick loop */ }
    }
  }
}
