export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat('es-ES', options).format(value);
}

export function formatBytes(value: number): string {
  if (value < 1024) {
    return `${formatNumber(value)} B`;
  }

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let amount = value;
  let unitIndex = -1;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${formatNumber(amount, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}
