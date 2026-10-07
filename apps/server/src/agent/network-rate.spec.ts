import { NetworkRateTracker } from './network-rate';

describe('network rates use observed monotonic intervals', () => {
  it.each([5000, 10000, 25000, 60000])('uses an actual %i ms interval', (interval) => {
    const tracker = new NetworkRateTracker();
    expect(tracker.sample('a', 1000, 2000, 100)).toEqual({ input: 0, output: 0 });
    expect(tracker.sample('a', 11000, 22000, interval + 100)).toEqual({ input: 10000000 / interval, output: 20000000 / interval });
  });

  it('handles counter resets independently and resumes from the new baseline', () => {
    const tracker = new NetworkRateTracker();
    tracker.sample('a', 10000, 20000, 0);
    expect(tracker.sample('a', 100, 30000, 10000)).toEqual({ input: 0, output: 1000 });
    expect(tracker.sample('a', 1100, 31000, 20000)).toEqual({ input: 100, output: 100 });
  });

  it('ignores duplicate/reordered timestamps without corrupting the baseline', () => {
    const tracker = new NetworkRateTracker();
    tracker.sample('a', 1000, 1000, 10000);
    expect(tracker.sample('a', 0, 0, 10000)).toEqual({ input: 0, output: 0 });
    expect(tracker.sample('a', 0, 0, 9000)).toEqual({ input: 0, output: 0 });
    expect(tracker.sample('a', 2000, 2000, 20000)).toEqual({ input: 100, output: 100 });
  });

  it('isolates servers and resets after long gaps or process restart', () => {
    const tracker = new NetworkRateTracker();
    tracker.sample('a', 1000, 1000, 0);
    expect(tracker.sample('b', 50000, 50000, 10000)).toEqual({ input: 0, output: 0 });
    expect(tracker.sample('a', 50000, 50000, 310000)).toEqual({ input: 0, output: 0 });
    expect(tracker.sample('a', 51000, 51000, 320000)).toEqual({ input: 100, output: 100 });
    expect(new NetworkRateTracker().sample('a', 52000, 52000, 330000)).toEqual({ input: 0, output: 0 });
  });
});
