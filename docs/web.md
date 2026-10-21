# Web channel

`web/` is a Cloudflare Worker with static assets. It serves one chat page and
forwards `/api/*` to the server. Page and API share one origin, so there is no
CORS.

| Path                                              | Owns                                                   |
| ------------------------------------------------- | ------------------------------------------------------ |
| [`src/index.ts`](../web/src/index.ts)             | Routing: `/api/*` to the server, the rest to the page. |
| [`public/`](../web/public)                        | The page: `index.html`, `style.css`, `app.js`.         |
| [`wrangler.jsonc`](../web/wrangler.jsonc)         | Production config: assets and the `CASERITA` binding.  |
| [`wrangler.dev.jsonc`](../web/wrangler.dev.jsonc) | Local config, see [Run locally](#run-locally).         |
| [`dev/`](../web/dev)                              | The local relay to the server.                         |

## How a request travels

The Worker answers `/api` and `/api/*` with `env.CASERITA.fetch`. `CASERITA` is
a [Workers VPC](https://developers.cloudflare.com/workers-vpc/) service binding.
It reaches the server through a Cloudflare Tunnel on the host, so the server has
no public address. Every other path is a static asset.

The Worker changes only the URL scheme to `http:`. The scheme picks the port of
the VPC service and whether the tunnel speaks TLS to the server, and the server
speaks plain HTTP. Method, path, query, headers and body pass through.

The page calls `POST /api/mensaje` (JSON `{texto}` or multipart `audio`),
`GET /api/resumen`, and `GET /api/movimientos`. It sends movement edits and
deletions to the movement routes. It never calls `POST /api/semana`, which needs
the admin token. See [the API](api.md).

## The page

- One large button records a voice note. Hold it and let go to send, or tap to
  start and tap again to send.
- A box under it takes a typed message.
- Two buttons ask for the week's summary and for the payment estimate.
- Each reply has a speaker button that reads it aloud with the browser's Spanish
  voice (`speechSynthesis`). It needs no service and is hidden when the browser
  has no speech synthesis.
- `MediaRecorder` records `audio/webm` or `audio/mp4`, whichever the browser
  supports. The server accepts both.
- A refused or missing microphone shows a message and the typed box still works.

The page has two tabs: `Chat` and `Mis cuentas`. The account tab shows the
week's three cash figures, open fiado, the payment estimate, pending amounts,
and movements grouped by day. Tapping a movement opens its editor. The editor
can change quantity or amount, delete one movement, or clear the whole account
after a confirmation. It loads both account endpoints whenever the tab opens, so
messages received on WhatsApp appear the next time the tab opens.

The summary is built in the page from `GET /api/resumen`. The payment estimate
is the server's own reply to the question "¿Cuánto puedo pagar de cuota al
mes?".

## Run locally

A VPC binding has no local simulator. `wrangler dev` with the production config
needs a Cloudflare login and a real tunnel. For local work, `wrangler.dev.jsonc`
binds `CASERITA` to the Worker in `dev/`, which relays to
`http://127.0.0.1:8787`.

```sh
node server/src/server.ts    # the server, with the keys in .env
bun run web:dev              # the page on http://localhost:8799
```

Open the page in a desktop browser, in a phone-sized window. The microphone
works on `localhost` and on HTTPS only.

## Deploy

A maintainer needs a Cloudflare account with Workers VPC and a host that runs
the server and keeps it running.

1. Log in to Wrangler: `bunx wrangler login`.
2. Create a tunnel:

   ```sh
   bunx wrangler tunnel create caserita
   ```

   It prints the tunnel UUID. Note it as `TUNNEL_ID`.

3. Run the tunnel on the host, next to the server. Keep it running as a service
   (systemd, or any supervisor):

   ```sh
   bunx wrangler tunnel run caserita
   ```

4. Create the VPC service. It points the tunnel at the server's port. Use the
   `PORT` the server listens on (`8787` by default):

   ```sh
   bunx wrangler vpc service create caserita --type http \
     --tunnel-id "$TUNNEL_ID" --ipv4 127.0.0.1 --http-port 8787
   ```

   The Worker calls the service with `http:`, so `--http-port` is the port that
   matters. The command prints the service id. Note it as `VPC_SERVICE_ID`.

5. Deploy the Worker:

   ```sh
   VPC_SERVICE_ID=<the id from step 4> bun run web:deploy
   ```

   The script copies `web/wrangler.jsonc` to the git-ignored
   `web/wrangler.deploy.jsonc`, with `VPC_SERVICE_ID` replaced by the id, and
   runs `wrangler deploy` with it. The id never goes into the repository.

6. Open the `*.workers.dev` address that `wrangler deploy` prints.

The server needs `GROQ_API_KEY`, and `GEMINI_API_KEY` for the fallback. See the
README.

To change the tunnel or the port later, run
`wrangler vpc service update <VPC_SERVICE_ID>` with the full set of options from
step 4.
