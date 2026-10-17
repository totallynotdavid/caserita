# Business rules

What Caserita records and how it counts. The code is in
[`book.ts`](../server/src/book.ts). The answer key it must match is
[`ejemplos_respuestas.csv`](../server/fixtures/ejemplos_respuestas.csv).

## Row types

| `tipo`        | When                                                                      | Cash |
| ------------- | ------------------------------------------------------------------------- | ---- |
| `venta`       | A sale paid on the spot.                                                  | +    |
| `gasto`       | Purchases, services, payments, helpers, and money refunded to a customer. | −    |
| `fiado`       | A sale on credit: the customer takes the product and pays later.          | none |
| `cobro_fiado` | A customer pays something they owed.                                      | +    |

Weekly cash flow = ventas + cobros de fiado − gastos. A `fiado` adds nothing
until it is paid.

## Amounts

- `monto` is the line total in soles: the total the message states, else
  `cantidad × precio_unitario − descuento`.
- Amounts are exact to the cent. The code works in integer cents.
- A missing amount is never invented and never 0. `monto` stays empty and
  `requiere_confirmacion` is `SI`. In a conversation the reply asks for it, and
  the next message that gives the figure fills the row and clears `SI`.
- The question goes to the row asked about last. When it is answered, the next
  row still waiting is asked.
- One message gives several rows (one per product or operation) or none: a
  personal purchase gives no row.
- A message that corrects itself ("no perdón, fueron 8") records the corrected
  version only.
- A message id seen before adds no row and returns the first reply.

## Credit

The ledger is derived from the rows, per customer. "la señora Rosa María" and
"Rosa Maria" are the same customer.

- A `fiado` with an amount opens a credit. One without an amount opens nothing
  to collect.
- A payment whose amount equals what a credit still owes settles that credit and
  takes its product name. Any other amount is a partial payment, named
  `pago parcial <cliente>`, and reduces the customer's oldest credits first.
- A payment with no amount takes what the customer's credit still owes. It picks
  the credit that matches the product the message names, else the customer's
  only open credit. When it cannot choose, the amount stays empty and the row is
  named `pago fiado <cliente>`.

## Payment estimate

Triggered by a question about the monthly payment ("¿Cuánto puedo pagar de cuota
al mes?").

1. Monthly flow = weekly flow × 52 / 12, rounded to the cent.
2. The payment is 30% of the monthly flow, rounded down to a multiple of 10
   soles.
3. A weekly flow of 0 or less, or a 30% below 10 soles, gives no amount and the
   answer says why.
4. Rows waiting for an amount are left out and named in the answer.

The answer shows each step in plain Spanish and says it is an estimate, not a
loan approval. Caserita never promises or approves a loan.

## Row names

The answer key fixes how a row is named. The reading prompt in
[`prompt.ts`](../server/src/prompt.ts) teaches the model these forms.

| Case                            | `producto`                                                                                                                          |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Goods sold                      | Lowercase Spanish with accents, singular: `pan`, `gaseosa`, `atún`, `cerveza`, `leche gloria`. Always plural: `huevos`, `galletas`. |
| Unit of measure                 | Left out: "2 kilos de azúcar" is `azúcar`, `cantidad` 2.                                                                            |
| Wholesale purchase by container | The container stays: `saco de arroz`.                                                                                               |
| Service or purchase             | The thing: `agua`, `balón de gas`, `galletas`, `bolsas`.                                                                            |
| Payment to a supplier           | `<producto> proveedor`: `gaseosas proveedor`.                                                                                       |
| Pay to a helper                 | `ayudante`.                                                                                                                         |
| Refund to a customer            | `devolución <producto>`, a `gasto`.                                                                                                 |
| Daily lump sum                  | One row, `cantidad` 1. `ventas sueltas`, or the name the message gives (`abarrotes sueltos`).                                       |
| Full credit payment             | The product of the credit: `aceite primor`.                                                                                         |
| Partial credit payment          | `pago parcial <cliente>`: `pago parcial don Pepe`.                                                                                  |
