import { once } from 'node:events';
import mineflayer, { type Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { ActionScheduler, SPEED_PRESETS, type SchedulerConfig, type ActionRecord, type EnqueueOptions } from './scheduler.ts';
import { DEFAULT_LIMITS, type Body, type BodyLimits, fmt } from './body.ts';
import { ACTIONS_BY_NAME } from './actions.ts';
import { Reflexes } from './reflexes.ts';

export interface AgentOptions {
  host: string;
  port: number;
  username: string;
  version?: string;
  speed?: SchedulerConfig;
  limits?: Partial<BodyLimits>;
  reflexes?: boolean;
}

/** Append-only log of things that happened, read incrementally by the brain. */
export class EventLog {
  private lines: { seq: number; tick: number; text: string }[] = [];
  private seq = 0;
  constructor(private max = 300) {}
  push(tick: number, text: string) {
    this.lines.push({ seq: ++this.seq, tick, text });
    if (this.lines.length > this.max) this.lines.shift();
  }
  since(seq: number) { return this.lines.filter(l => l.seq > seq); }
  get head() { return this.seq; }
}

export class Agent {
  readonly body: Body;
  readonly scheduler: ActionScheduler<Body>;
  readonly events = new EventLog();
  readonly reflexes: Reflexes;

  private constructor(readonly bot: Bot, opts: AgentOptions) {
    this.body = { bot, limits: { ...DEFAULT_LIMITS, ...opts.limits } };
    this.scheduler = new ActionScheduler(opts.speed ?? SPEED_PRESETS.human, this.body);
    this.reflexes = new Reflexes(this, opts.reflexes ?? true);

    this.scheduler.onEvent(e => {
      if (e.type !== 'finished') return;
      const r = e.record;
      const dur = r.startedTick !== undefined ? ` in ${r.endedTick! - r.startedTick}t` : '';
      this.log(`#${r.id} ${r.action.name} ${r.state.toUpperCase()}${dur}: ${r.result}`);
    });
    bot.on('chat', (user, msg) => { if (user !== bot.username) this.log(`<${user}> ${msg}`); });
    bot.on('death', () => { this.scheduler.cancelAll('died'); this.log('YOU DIED'); });
    bot.on('entityHurt', ent => { if (ent === bot.entity) this.log(`took damage, health ${bot.health.toFixed(0)}/20`); });

    // One loop drives everything: reflexes, then the scheduler. 20 Hz, in lock-step with the game.
    bot.on('physicsTick', () => {
      this.reflexes.tick();
      this.scheduler.tick();
    });
  }

  static async connect(opts: AgentOptions): Promise<Agent> {
    const bot = mineflayer.createBot({ host: opts.host, port: opts.port, username: opts.username, version: opts.version, auth: 'offline' });
    bot.loadPlugin(pathfinderPkg.pathfinder);
    await once(bot as unknown as NodeJS.EventEmitter, 'spawn');
    return new Agent(bot, opts);
  }

  log(text: string) { this.events.push(this.scheduler?.tick_ ?? 0, text); }

  /** Queue an ability by name with tool-style args. Throws on unknown names / bad args. */
  do(name: string, args: Record<string, unknown> = {}, opts: EnqueueOptions = {}): ActionRecord<Body> {
    const spec = ACTIONS_BY_NAME.get(name);
    if (!spec) throw new Error(`unknown action ${name}`);
    for (const k of spec.required) if (args[k] === undefined) throw new Error(`${name}: missing ${k}`);
    return this.scheduler.enqueue(spec.build(args, this.body), opts);
  }

  /** Resolve when every given action has finished (or timeout). */
  async waitFor(ids: number[], timeoutMs: number): Promise<void> {
    const pending = () => ids.some(id => {
      const s = this.scheduler.get(id)?.state;
      return s === 'queued' || s === 'running';
    });
    const deadline = Date.now() + timeoutMs;
    while (pending() && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  }

  quit() { this.bot.quit(); }

  describeRecord(r: ActionRecord<Body>): string {
    return `#${r.id} ${r.action.name} [${r.action.channels.join('+')}] ${r.state}${r.result ? `: ${r.result}` : ''}`;
  }

  where(): string { return fmt(this.bot.entity.position); }
}
