import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

function fake(name: string) {
  const seen: Request[] = [];
  const fetcher = {
    fetch: async (request: Request) => {
      seen.push(request);
      return new Response(name);
    },
  } as unknown as Fetcher;
  return { fetcher, seen };
}

function setup() {
  const caserita = fake("server");
  const assets = fake("page");
  const env = { CASERITA: caserita.fetcher, ASSETS: assets.fetcher };
  return { env, caserita, assets };
}

describe("worker routing", () => {
  it("forwards /api requests to the server binding over plain http", async () => {
    const { env, caserita, assets } = setup();
    const request = new Request("https://caserita.example/api/mensaje?x=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "vendí 3 atunes" }),
    });

    const response = await worker.fetch(request, env);

    expect(await response.text()).toBe("server");
    const [forwarded] = caserita.seen;
    expect(caserita.seen).toHaveLength(1);
    expect(forwarded?.url).toBe("http://caserita.example/api/mensaje?x=1");
    expect(forwarded?.method).toBe("POST");
    expect(forwarded?.headers.get("content-type")).toBe("application/json");
    expect(await forwarded?.json()).toEqual({ texto: "vendí 3 atunes" });
    expect(assets.seen).toHaveLength(0);
  });

  it("forwards a voice note upload with its body intact", async () => {
    const { env, caserita } = setup();
    const form = new FormData();
    form.append("audio", new Blob(["abc"], { type: "audio/webm" }), "n.webm");
    await worker.fetch(
      new Request("https://caserita.example/api/mensaje", {
        method: "POST",
        body: form,
      }),
      env,
    );
    const [forwarded] = caserita.seen;
    const audio = (await forwarded!.formData()).get("audio") as File;
    expect(audio.type).toBe("audio/webm");
    expect(await audio.text()).toBe("abc");
  });

  it("forwards /api/resumen", async () => {
    const { env, caserita } = setup();
    await worker.fetch(
      new Request("https://caserita.example/api/resumen"),
      env,
    );
    expect(caserita.seen.map((r) => r.url)).toEqual([
      "http://caserita.example/api/resumen",
    ]);
  });

  it.each(["/", "/index.html", "/apiary", "/app.js"])(
    "serves the page for %s",
    async (path) => {
      const { env, caserita, assets } = setup();
      const response = await worker.fetch(
        new Request(`https://caserita.example${path}`),
        env,
      );
      expect(await response.text()).toBe("page");
      expect(assets.seen).toHaveLength(1);
      expect(caserita.seen).toHaveLength(0);
    },
  );
});
