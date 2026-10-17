# Deploy

Caserita runs on one Linux host. Docker Compose starts the Node server and a
Cloudflare Tunnel connector. The server publishes port `8787` only on the host's
loopback interface. The tunnel reaches it as `http://caserita:8787` on the
Compose network.

## Requirements

Install Docker Engine with the Compose plugin, Bun, and mise. The host needs
outbound UDP port `7844` for the tunnel's QUIC transport. `cloudflared` must be
version `2025.7.0` or newer.

Install the project dependencies from the lockfile:

```sh
mise run install
```

## Secrets

Create one file outside the repository. The default path is `../caserita.env`.
Set `CASERITA_ENV_FILE` when using another path.

```sh
cat > ../caserita.env <<'EOF'
GROQ_API_KEY=replace-with-groq-key
GEMINI_API_KEY=replace-with-gemini-key
ADMIN_TOKEN=replace-with-a-long-admin-token
WHATSAPP=on
TUNNEL_TOKEN=replace-with-cloudflare-tunnel-token
EOF
chmod 600 ../caserita.env
```

`WHATSAPP=on` enables the WhatsApp channel. The other values are the model keys,
the `/api/semana` bearer token, and the remotely managed Tunnel token. Do not
commit this file.

## Cloudflare account setup

Run these steps in the Cloudflare account. They create the account resources;
the repository does not contain account IDs, service IDs, or tokens.

### Create the remotely managed Tunnel

1. Open the Cloudflare dashboard at `https://dash.cloudflare.com/` and go to
   **Networking > Tunnels**.
2. Select **Create a tunnel**, choose **Cloudflared**, and name it `caserita`.
3. Select **Save tunnel**. Record the Tunnel ID shown by the dashboard.
4. Select **Add a replica**, copy the `cloudflared` installation command into a
   text editor, and copy only its `eyJ...` token into `TUNNEL_TOKEN` in
   `caserita.env`. Do not commit or paste the token into this repository.

### Create the Workers VPC service

The VPC service must point at the Compose hostname and port, not the host's
loopback address. From the repository root, run:

```sh
cd web
bunx wrangler login
bunx wrangler vpc service create caserita \
  --type http \
  --tunnel-id <TUNNEL_ID> \
  --hostname caserita \
  --http-port 8787
cd ..
```

Save the `service_id` printed by Wrangler. In `web/wrangler.jsonc`, add or
update the VPC service binding used by the Worker. The binding name must match
the name used by the Worker source:

```jsonc
"vpc_services": [
  {
    "binding": "CASERITA_API",
    "service_id": "<VPC_SERVICE_ID>"
  }
]
```

The VPC service fixes the private destination to `caserita:8787`; the URL passed
by the Worker selects the request path. Deploy the Worker after saving the
service ID:

```sh
mise run deploy:web
```

## Deploy the server

Start both Compose services from the repository root:

```sh
CASERITA_ENV_FILE=../caserita.env mise run deploy:server
```

Check the local server and its Compose health state:

```sh
curl -fsS http://127.0.0.1:8787/api/resumen
docker compose --env-file "${CASERITA_ENV_FILE:-../caserita.env}" ps
```

The healthcheck uses `GET /api/resumen`. That route reads the local store and
does not require a model call or an authorization token.

## Link WhatsApp

With `WHATSAPP=on`, the server writes the linking QR string to
`/app/data/whatsapp-qr.txt`. The file is inside the `caserita-data` volume. Wait
for the file, render its contents in the terminal, and scan it from WhatsApp's
**Linked devices** screen:

```sh
until docker compose --env-file "${CASERITA_ENV_FILE:-../caserita.env}" \
  exec -T caserita sh -c 'test -s /app/data/whatsapp-qr.txt'; do
  sleep 1
done
docker compose --env-file "${CASERITA_ENV_FILE:-../caserita.env}" \
  exec -T caserita sh -c 'cat /app/data/whatsapp-qr.txt' \
  | qrencode -t ansiutf8
```

Install `qrencode` on a Debian or Ubuntu host if it is not present:

```sh
sudo apt-get update
sudo apt-get install --yes qrencode
```

The WhatsApp credentials stay in the same `caserita-data` volume as the SQLite
file.

## Load a week

Prepare the CSV according to the [`POST /api/semana` contract](api.md) and send
it to the server with the admin token:

```sh
set -a
. "${CASERITA_ENV_FILE:-../caserita.env}"
set +a
curl --fail-with-body -X POST http://127.0.0.1:8787/api/semana \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H 'content-type: text/csv' \
  --data-binary @semana.csv \
  > resultado.csv
```

The Worker forwards `/api/*` to the same server. Use its deployed URL for remote
requests after the Worker deployment.

## Roll back

Keep the last known-good repository revision and Worker version ID with the
deployment record. To roll back the host, check out the previous good commit and
rebuild the server:

```sh
git checkout <GOOD_DEPLOYMENT_COMMIT>
CASERITA_ENV_FILE=../caserita.env mise run deploy:server
```

To inspect recent Worker versions and roll the Worker back, run:

```sh
cd web
bunx wrangler deployments list --name caserita-web --json
bunx wrangler rollback <WORKER_VERSION_ID>
cd ..
```

The Worker rollback changes the Worker version only. It does not roll back the
VPC service, Tunnel, SQLite data, or WhatsApp credentials.
