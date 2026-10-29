import { DurableObject } from "cloudflare:workers";
// @ts-ignore plain JS modules
import { createEngine } from "./engine.mjs";
// @ts-ignore plain JS module
import { hydrate, setPersistence } from "./shims/fs.mjs";

interface Env {
  AI: unknown;
  NVIDIA_API_KEY?: string;
}

const FILE_PREFIX = "file:";
// How long a cron wake keeps the object alive so its 15-second trading loops can run.
const TICK_HOLD_MS = 50_000;

// One instance holds the whole engine: paper accounts, the investment room, the agent desk
// and their timers. The files the original server wrote to disk are mirrored into this
// object's storage, so everything survives restarts and redeploys.
export class EngineDO extends DurableObject<Env> {
  private engine: { handle(request: Request): Promise<Response> } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list<string>({ prefix: FILE_PREFIX });
      const files: Record<string, string> = {};
      for (const [key, value] of stored) files[key.slice(FILE_PREFIX.length)] = value;
      hydrate(files);
      setPersistence((path: string, text: string | null) => {
        const key = FILE_PREFIX + path;
        const op = text === null ? ctx.storage.delete(key) : ctx.storage.put(key, text);
        op.catch((error: unknown) => console.error("persist failed", path, String(error)));
      });
      this.engine = createEngine(env);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__tick") {
      await new Promise((resolve) => setTimeout(resolve, TICK_HOLD_MS));
      return Response.json({ ok: true, held: TICK_HOLD_MS });
    }
    return this.engine!.handle(request);
  }
}
