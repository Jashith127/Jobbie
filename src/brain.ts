/**
 * The deliberative layer: Claude decides WHAT to do; the scheduler decides
 * WHEN and makes it happen at 20 Hz.
 *
 * Every ability is exposed as its own tool. Claude can emit several tool calls
 * in one response (parallel tool use) and each becomes a queued action; the
 * scheduler runs them truly concurrently when they use different body
 * channels. The LLM never blocks the game loop: actions keep running while
 * Claude thinks, and reflexes cover anything that can't wait for an API call.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Agent } from './agent.ts';
import { ACTIONS } from './actions.ts';
import { observe } from './observe.ts';

export interface BrainOptions {
  goal: string;
  model?: string;
  /** Lower effort = faster decisions. Gameplay is latency-sensitive, so default low. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Start a fresh conversation (carrying notes) after this many turns. */
  turnsPerEpisode?: number;
  /** Hard cap on API calls, to bound cost. */
  maxTurns?: number;
  log?: (s: string) => void;
  /** Injected for tests; defaults to a client using ANTHROPIC_API_KEY / ant profile. */
  client?: Pick<Anthropic, 'beta'>;
}

const SYSTEM = `You are playing Minecraft survival as a player, through a body with the same limits as a human at a keyboard and mouse.

Your body has five channels: LEGS (movement keys), HEAD (mouse look), HANDS (left/right click: mine, place, attack, eat), INVENTORY (equip, craft, toss), CHAT.
Each tool says which channels it uses. Actions on different channels run AT THE SAME TIME, so issue them together in one response:
- move_toward (legs) + look_at (head) = walk while watching something
- move_toward (legs) + mine (head+hands) = mine a block you pass by
- move_toward (legs) + eat (hands) = eat while retreating
- move_toward (legs) + attack (head+hands) = chase or kite a mob
Actions that share a channel queue up and run one after another, in the order you issued them, so you can also queue a short sequence (e.g. mine, mine, mine).

Every action tool returns immediately with an id like #12; it then runs in the game in real time (20 ticks = 1 second).
Use wait to let time pass until actions finish; it returns what happened. Use cancel to stop one. Use observe for a fresh view of the world.
Pass priority > 0 to make an action preempt lower-priority actions holding its channels (e.g. to flee).

Rules of the world, enforced by your body: no commands, you can only mine/place within 4.5 blocks and only the first block in your line of sight,
you only see blocks exposed to air, broken blocks drop items that you must walk over (pickup) to collect,
3x3 crafting needs a crafting_table placed within reach. Logs -> planks -> sticks/crafting_table -> wooden pickaxe -> stone tools, as usual.
Some reflexes (eating when hungry, swimming up) run automatically.

Work toward the goal efficiently. When an action fails, read the reason and adapt instead of retrying the same thing.
Keep text brief; act through tools. Use remember to save facts worth keeping across episodes (locations, progress).`;

type Input = Record<string, any>;

export class Brain {
  private client: Pick<Anthropic, 'beta'>;
  private notes: string[] = [];
  private turns = 0;
  private eventCursor = 0;
  private stopped = false;
  private readonly tools: Anthropic.Beta.BetaTool[];

  constructor(private agent: Agent, private opts: BrainOptions) {
    this.client = opts.client ?? new Anthropic();
    const priority = { type: 'integer', description: 'optional; >0 preempts lower-priority actions on the same channels' };
    this.tools = [
      ...ACTIONS.map(spec => ({
        name: spec.name,
        description: `[${spec.channels.join('+').toUpperCase()}] ${spec.description}`,
        input_schema: { type: 'object' as const, properties: { ...spec.properties, priority }, required: spec.required },
      })),
      {
        name: 'wait',
        description: 'Let game time pass until the given action ids have all finished, or `seconds` elapse (max 20). Returns events that happened.',
        input_schema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'integer' } }, seconds: { type: 'number' } }, required: [] },
      },
      {
        name: 'cancel',
        description: 'Cancel a queued or running action by id.',
        input_schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
      },
      {
        name: 'observe',
        description: 'Get a fresh observation: status, inventory, visible blocks, entities, and what each body channel is doing.',
        input_schema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'remember',
        description: 'Save a short note that persists into future episodes (conversations are periodically restarted).',
        input_schema: { type: 'object', properties: { note: { type: 'string' } }, required: ['note'] },
      },
    ];
  }

  stop() { this.stopped = true; }

  private log(s: string) { (this.opts.log ?? console.log)(s); }

  private newEvents(): string {
    const ev = this.agent.events.since(this.eventCursor);
    this.eventCursor = this.agent.events.head;
    return ev.length ? ev.map(e => `[t${e.tick}] ${e.text}`).join('\n') : 'no new events';
  }

  async run(): Promise<void> {
    const maxTurns = this.opts.maxTurns ?? 500;
    while (!this.stopped && this.turns < maxTurns) {
      await this.episode();
    }
    this.log(`brain stopped after ${this.turns} turns`);
  }

  /** One conversation. Append-only, so prompt caching and thinking carry across turns. */
  private async episode(): Promise<void> {
    const perEpisode = this.opts.turnsPerEpisode ?? 40;
    this.eventCursor = this.agent.events.head;
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content:
          `GOAL: ${this.opts.goal}\n\n` +
          (this.notes.length ? `Your notes from earlier:\n- ${this.notes.join('\n- ')}\n\n` : '') +
          `Current observation:\n${observe(this.agent)}`,
      },
    ];

    for (let i = 0; i < perEpisode && !this.stopped && this.turns < (this.opts.maxTurns ?? 500); i++) {
      this.turns++;
      let res: Anthropic.Beta.BetaMessage;
      try {
        res = await this.client.beta.messages.create({
          model: this.opts.model ?? 'claude-opus-5-5',
          max_tokens: 16000,
          system: SYSTEM,
          tools: this.tools,
          messages,
          thinking: { type: 'adaptive' },
          output_config: { effort: this.opts.effort ?? 'low' },
          cache_control: { type: 'ephemeral' },
          // If a request is declined by a safety classifier, retry it on a fallback model server-side.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError) {
          this.log(`API transient error, backing off: ${(e as Error).message}`);
          await sleep(5000);
          i--;
          continue;
        }
        throw e;
      }

      messages.push({ role: 'assistant', content: res.content });
      for (const b of res.content) if (b.type === 'text' && b.text.trim()) this.log(`claude: ${b.text.trim()}`);

      if (res.stop_reason === 'refusal') {
        this.log(`request declined (${res.stop_details?.category ?? 'unknown'}); starting a new episode`);
        return;
      }

      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (uses.length === 0) {
        // Claude ended its turn without acting: let the world move, then report back.
        await sleep(2000);
        messages.push({ role: 'user', content: `Events:\n${this.newEvents()}\n\nObservation:\n${observe(this.agent)}` });
        continue;
      }

      // Start every action first (so they run in parallel), then process waits.
      const results = new Map<string, Anthropic.Beta.BetaToolResultBlockParam>();
      const ok = (id: string, content: string, is_error = false) => results.set(id, { type: 'tool_result', tool_use_id: id, content, is_error });
      for (const u of uses.filter(u => u.name !== 'wait')) {
        const input = (u.input ?? {}) as Input;
        try {
          if (u.name === 'cancel') ok(u.id, this.agent.scheduler.cancel(input.id, 'cancelled by brain') ? `cancelled #${input.id}` : `#${input.id} not active`);
          else if (u.name === 'observe') ok(u.id, observe(this.agent));
          else if (u.name === 'remember') { this.notes.push(String(input.note).slice(0, 300)); this.notes = this.notes.slice(-30); ok(u.id, 'saved'); }
          else {
            const { priority, ...args } = input;
            const rec = this.agent.do(u.name, args, { priority: priority ?? 0, replace: false });
            this.log(`  -> #${rec.id} ${rec.action.name} [${rec.action.channels.join('+')}]`);
            ok(u.id, `queued as #${rec.id} on ${rec.action.channels.join('+')}`);
          }
        } catch (e) {
          ok(u.id, (e as Error).message, true);
        }
      }
      for (const u of uses.filter(u => u.name === 'wait')) {
        const input = (u.input ?? {}) as Input;
        const seconds = Math.min(20, Math.max(0.2, Number(input.seconds ?? 5)));
        const ids: number[] = Array.isArray(input.ids) && input.ids.length
          ? input.ids
          : [...this.agent.scheduler.snapshot().running, ...this.agent.scheduler.snapshot().queued].map(r => r.id);
        await this.agent.waitFor(ids, seconds * 1000);
        const status = ids.map(id => { const r = this.agent.scheduler.get(id); return r ? this.agent.describeRecord(r) : `#${id} unknown`; });
        ok(u.id, status.join('\n') || 'nothing was running');
      }

      // All tool results go back in ONE user message (keeps Claude issuing parallel calls), plus what happened meanwhile.
      messages.push({
        role: 'user',
        content: [...uses.map(u => results.get(u.id)!), { type: 'text', text: `Events since your last turn:\n${this.newEvents()}` }],
      });
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
