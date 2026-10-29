import { EngineDO } from "./engine-do";

export { EngineDO };

interface Env {
  ASSETS: Fetcher;
  ENGINE: DurableObjectNamespace<EngineDO>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const engine = (env: Env) => env.ENGINE.get(env.ENGINE.idFromName("main"));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/cloudflare-health") {
      return json({ ok: true, service: "tradebotzi-cloudflare-edge", deployment: "cloudflare-worker", engine: "durable-object" });
    }

    if (url.pathname.startsWith("/api/")) {
      try {
        return await engine(env).fetch(request);
      } catch (error) {
        return json({ ok: false, error: "engine_failed", detail: String(error) }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },

  // Cron wake-up: keeps the paper-trading loops ticking while nobody has the page open.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await engine(env).fetch("https://engine.internal/__tick");
  },
} satisfies ExportedHandler<Env>;
