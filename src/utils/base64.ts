/** Decodifica una cadena base64 a bytes. Usa Buffer (Node, disponible en el renderer de Electron). */
export function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}
