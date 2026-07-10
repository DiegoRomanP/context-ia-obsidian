/** Envuelve fn para ignorar reentradas: si ya hay una llamada en curso, las siguientes devuelven undefined. */
export function once<T>(fn: () => Promise<T>): () => Promise<T | undefined> {
  let running = false;
  return async () => {
    if (running) return undefined; // ignora reentradas
    running = true;
    try {
      return await fn();
    } finally {
      running = false;
    }
  };
}
