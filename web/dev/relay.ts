interface Env {
  SERVER_ORIGIN: string;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const { pathname, search } = new URL(request.url);
    return fetch(new Request(env.SERVER_ORIGIN + pathname + search, request));
  },
} satisfies ExportedHandler<Env>;
