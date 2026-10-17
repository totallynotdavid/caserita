/** Soles to integer cents, rounding half up. */
export function aCentavos(monto: number): number {
  return Math.round(Math.round(monto * 1e6) / 1e4);
}

/** Cents to the CSV form: a decimal point and two decimals, no currency. */
export function formatoMonto(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}${Math.floor(abs / 100)}.${cents}`;
}

/** Cents to the form used in replies to the shopkeeper. */
export function soles(centavos: number): string {
  return `S/ ${formatoMonto(centavos)}`;
}
