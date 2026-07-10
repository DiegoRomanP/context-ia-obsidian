import { vi } from "vitest";

export class TFile {
  path = "";
  basename = "";
  extension = "";
}

export class App {}

// Mock compartido: cada test resetea con requestUrl.mockReset()/mockResolvedValue() según necesite.
export const requestUrl = vi.fn();
