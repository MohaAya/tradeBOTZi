interface Env {
  ASSETS: Fetcher;
  LEGACY_API_ORIGIN: string;
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/cloudflare-health") {
      return json({
        ok: true,
        service: "tradebotzi-cloudflare-edge",
        deployment: "cloudflare-worker",
        legacyApiProxy: Boolean(env.LEGACY_API_ORIGIN),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (!env.LEGACY_API_ORIGIN) {
        return json({ ok: false, error: "legacy_api_origin_not_configured" }, 503);
      }

      try {
        const target = new URL(url.pathname + url.search, env.LEGACY_API_ORIGIN);
        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.set("x-tradebotzi-edge", "cloudflare");

        const upstream = new Request(target.toString(), {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual",
        });

        return await fetch(upstream);
      } catch (error) {
        return json({
          ok: false,
          error: "legacy_api_proxy_failed",
          detail: String(error),
        }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
