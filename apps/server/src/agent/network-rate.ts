const MAX_GAP_MS = 5 * 60 * 1000;

/** A process-local baseline: restarts and long gaps start a new measurement. */
export class NetworkRateTracker {
  private readonly previous = new Map<string, { input: number; output: number; at: number }>();
  private lastPrune = 0;

  sample(id: string, input: number, output: number, at: number) {
    if (at - this.lastPrune > MAX_GAP_MS) {
      for (const [key, value] of this.previous) {
        if (at - value.at > MAX_GAP_MS) this.previous.delete(key);
      }
      this.lastPrune = at;
    }
    const prev = this.previous.get(id);
    // A delayed request must not replace the baseline of a newer request.
    if (prev && at <= prev.at) return { input: 0, output: 0 };
    this.previous.set(id, { input, output, at });
    if (!prev || at - prev.at > MAX_GAP_MS) return { input: 0, output: 0 };
    const seconds = (at - prev.at) / 1000;
    return {
      input: Math.max(0, input - prev.input) / seconds,
      output: Math.max(0, output - prev.output) / seconds,
    };
  }
}
