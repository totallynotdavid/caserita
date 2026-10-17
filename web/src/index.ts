interface Env {
  /** Reaches the Caserita server through a Cloudflare Tunnel. */
  CASERITA: Fetcher;
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      // The URL scheme picks the service's port and whether the tunnel speaks
      // TLS to it. The server listens in plain HTTP.
      url.protocol = "http:";
      return env.CASERITA.fetch(new Request(url, request));
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
