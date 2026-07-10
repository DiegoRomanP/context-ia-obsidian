/** Sanea un fragmento para usarlo como parte de un nombre de archivo: evita separadores de ruta y traversal. */
export function sanitizeFileNamePart(input: string): string {
  const cleaned = input
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.\./g, "_")
    .trim();
  return cleaned || "nota";
}
