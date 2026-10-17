# WhatsApp channel

A spare phone number linked to Caserita. A person messages that number from
their own WhatsApp, by text or voice note, and gets the reply in the same chat.
The code is in [`whatsapp.ts`](../server/src/whatsapp.ts), started by
[`server.ts`](../server/src/server.ts).

Baileys is an unofficial WhatsApp client. WhatsApp can ban a number that uses
it. Link a spare number, never the shop's own.

## What it answers

- One-to-one chats only. Groups, status, broadcast lists, channels and messages
  sent by the linked number itself are ignored.
- A text message goes to `handle` as text. A voice note is downloaded and goes
  to `handle` as audio, and [`transcribe.ts`](../server/src/transcribe.ts) turns
  it into text. Any other kind of message is ignored.
- The WhatsApp message id is the message id, so a redelivered message adds no
  row and gets the first reply again.
- While it works the chat shows "escribiendo…". The reply is a plain message
  that quotes nothing.
- Messages run one at a time in arrival order, and share the queue of the HTTP
  channel, so a credit payment always sees the credit it pays.
- Every sender feeds Doña Rosa's one account.

## Settings

| Variable   | Meaning                                                              |
| ---------- | -------------------------------------------------------------------- |
| `WHATSAPP` | `on` starts the channel. Anything else leaves it off.                |
| `DB_PATH`  | Its folder is the data folder. `data/caserita.sqlite` gives `data/`. |

The data folder holds:

| Path                   | Content                                                  |
| ---------------------- | -------------------------------------------------------- |
| `data/whatsapp/`       | The saved session. A restart reconnects without linking. |
| `data/whatsapp-qr.txt` | The current raw QR while the number is not linked.       |

## Link the number

Run one process per number. Two live sockets on one session get the number
restricted.

1. Start the server with `WHATSAPP=on`:

   ```sh
   WHATSAPP=on node server/src/server.ts
   ```

2. With no saved session, the log prints a line `whatsapp qr: <text>` and the
   same text is written to `data/whatsapp-qr.txt`. Both change every 20 to 60
   seconds. Render the text from the file as a QR code with any QR tool.
3. On the spare number's phone open WhatsApp, then **Dispositivos vinculados**,
   then **Vincular dispositivo**, and scan the QR.
4. The log prints `whatsapp conectado` and the QR file is deleted.

The session is saved as it changes. Later starts connect on their own.

## Relink after a logout

When the phone unlinks the device, the log prints `whatsapp cerró la sesión` and
the channel stops. The HTTP server keeps running. Stop it, delete the saved
session, and start again to get a new QR:

```sh
rm -r data/whatsapp
WHATSAPP=on node server/src/server.ts
```

The channel also stops when another client takes the session (close code 440,
"connection replaced"). The log prints `otro cliente tomó la sesión`.
Reconnecting would displace that client, and the two would take turns until
WhatsApp restricts the number. Find and stop the other process, then restart
this one.

Any other disconnect reconnects after 3 seconds, or at once when WhatsApp asks
for a restart (it does after linking).

## Logs

At info level the log never holds a message text or a phone number. It holds the
kind of message (`texto` or `audio`), the QR line and the connection state.
