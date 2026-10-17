# HTTP API

The routes are in [`app.ts`](../server/src/app.ts), started by
[`server.ts`](../server/src/server.ts). Every route belongs to one account: Doña
Rosa's week.

## Rows

A row has the shape of the output CSV:

```json
{
  "id_mensaje": "E09",
  "tipo": "venta",
  "producto": "atún",
  "cantidad": "3",
  "monto": "",
  "requiere_confirmacion": "SI"
}
```

`monto` has a decimal point and two decimals, no currency, and is empty when
missing. `requiere_confirmacion` is `SI` or `NO`.

## `POST /api/mensaje`

Records one message and replies.

Text:

```sh
curl -s localhost:8787/api/mensaje -H 'content-type: application/json' \
  -d '{"texto":"vendí 3 atunes","id":"opcional"}'
```

Voice note, as `multipart/form-data` with an `audio` file and an optional `id`:

```sh
curl -s localhost:8787/api/mensaje -F 'audio=@nota.ogg;type=audio/ogg'
```

[`transcribe.ts`](../server/src/transcribe.ts) transcribes the audio (Groq
`whisper-large-v3`, Spanish) and the text is then handled like any message.
Accepted types: webm, ogg (Opus), mp4, m4a, mp3, wav and flac, up to 25 MB. A
`codecs=` parameter on the type is ignored.

Reply:

```json
{
  "respuesta": "¿A cuánto vendió los 3 atunes?",
  "filas": [],
  "transcripcion": "Vendí tres atunes."
}
```

- `filas` holds the rows this message created or filled in.
- `transcripcion` is present only for audio.
- Without `id` the server makes one. A repeated `id` returns the first reply,
  with the same `filas` and `transcripcion`, and adds no row. A repeated voice
  note is not transcribed again.
- A note that cannot be heard (silence, or Whisper fails) records nothing and
  replies asking for it again.

| Status | When                                        |
| ------ | ------------------------------------------- |
| 400    | No `texto`, or multipart without `audio`.   |
| 413    | Audio over 25 MB, refused while it uploads. |
| 415    | Audio type not in the list above.           |
| 500    | The model could not be reached or read.     |

## `POST /api/semana`

Replaces the week. The body is a CSV with the columns `id_mensaje,dia,mensaje`.
It needs `Authorization: Bearer $ADMIN_TOKEN`; with no configured token every
request gets 401. The messages are processed in order and the answer is the
output CSV (`text/csv`) with the header
`id_mensaje,tipo,producto,cantidad,monto,requiere_confirmacion`.

## `GET /api/resumen`

The week's totals as strings in soles: `ventas`, `cobros_fiado`, `gastos`,
`flujo_semanal`, `fiado_abierto`, the `pendientes` rows, and `estimacion` with
`flujo_mensual`, `cuota` (`null` when there is none) and the `explicacion` text.
The rules are in [the payment estimate](rules.md#payment-estimate).
