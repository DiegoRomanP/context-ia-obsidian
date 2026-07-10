export interface ImageResult {
  readonly bytes: Uint8Array; // PNG decodificado
  readonly mimeType: string; // "image/png"
  readonly model: string;
}
