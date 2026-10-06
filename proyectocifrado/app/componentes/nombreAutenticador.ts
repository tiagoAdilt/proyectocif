export function nombreAutenticador(nombre?: string, indice = 0): string {
  if (/^(Autenticador de respaldo|Respaldo)(\s|$)/i.test(nombre || '')) return 'Autenticador de respaldo';
  if (/^(Autenticador principal|Principal)(\s|$)/i.test(nombre || '')) return 'Autenticador principal';
  return nombre?.trim() || `Autenticador ${indice + 1}`;
}
