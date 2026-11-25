const spanishNumberFormatter = new Intl.NumberFormat('es-ES');

export function formatNumber(value: number): string {
  return spanishNumberFormatter.format(value);
}
