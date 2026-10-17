# caserita

Bookkeeping agent that turns a shopkeeper's WhatsApp notes into cash flow.

Doña Rosa runs a bodega in Lima. She writes her accounts as text and voice notes
("vendí 3 gaseosas a 2.50 y la vecina se llevó arroz fiado"). Caserita turns
each note into transaction rows, asks back when a figure is missing instead of
inventing it, computes the weekly cash flow, and answers "¿Cuánto puedo pagar de
cuota al mes?" with an amount in soles and the arithmetic behind it. It never
approves or promises a loan.

The language model reads the message. The code decides every amount. See
[the rules](docs/rules.md) and [the architecture](docs/architecture.md).

## Setup

Install [mise](https://mise.jdx.dev), then:

```sh
mise run install
cp .env.example .env   # then fill in the keys
```

| Variable         | Meaning                                        |
| ---------------- | ---------------------------------------------- |
| `GROQ_API_KEY`   | Reads messages and transcribes voice notes.    |
| `GEMINI_API_KEY` | Fallback reader when Groq answers 429 or 5xx.  |
| `ADMIN_TOKEN`    | Bearer token that protects `POST /api/semana`. |
| `PORT`           | HTTP port. Default `8787`.                     |
| `DB_PATH`        | SQLite file. Default `data/caserita.sqlite`.   |

A real environment variable wins over `.env`.

## Score the examples

```sh
mise run eval
```

Reads the 30 example messages with the real model and compares the rows with the
answer key. It prints each mismatched row, the score and the weekly cash flow,
and exits non-zero below full marks. On full marks it records the extractions in
`server/fixtures/extracciones.json`, which the offline test replays.

## Process a CSV

```sh
node server/bin/batch.ts server/fixtures/ejemplos_mensajes.csv salida.csv
```

The input has the columns `id_mensaje,dia,mensaje`. The messages are processed
in order as one week, in memory, and `salida.csv` gets the columns
`id_mensaje,tipo,producto,cantidad,monto,requiere_confirmacion`.

## Run the server

```sh
node server/src/server.ts
curl -s localhost:8787/api/mensaje -H 'content-type: application/json' \
  -d '{"texto":"vendí 3 atunes"}'
```

Routes, request and response shapes, and the voice-note upload are in
[the API reference](docs/api.md).

## Open the chat page

```sh
mise run web:dev
```

Serves the chat page on `http://localhost:8799`, with `/api` relayed to the
server on port 8787. Running it for real, and deploying it, are in
[the web channel](docs/web.md).

## Check

```sh
mise run check
```

Runs lint, type check and the tests. It needs no network and no secrets.
