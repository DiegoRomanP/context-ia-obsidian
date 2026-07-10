import type { ImageResult } from "../models/ImageResult";

export interface ImagePort {
  generate(prompt: string, size: string): Promise<ImageResult>;
}
