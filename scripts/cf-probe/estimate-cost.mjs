import { pathToFileURL } from 'node:url';

// China-site public prices checked 2026-11-01; no free tier/package assumed.
export const prices = { gbSecond: 0.00011108, invocation: 0.0133 / 10000, outboundGb: 0.8 };
// One settled Guangzhou hour: 16 HTTP calls, 54.2245 GBs, 0.00033322 GB out.
// Two calls per panel batch. This is a small-sample projection, not a bill cap.
export const sample = { calls: 16, gbSeconds: 54.2245, outboundGb: 0.00033322 };

export function estimateCost({ nodes = 4, regions = 2, days = 30, batchesPerDay = 96,
  gbSecondsPerBatch = sample.gbSeconds / (sample.calls / 2),
  outboundGbPerBatch = sample.outboundGb / (sample.calls / 2),
  extraResponseGbPerBatch = 0, monthlyBatchCap = null } = {}) {
  for (const value of [nodes, regions, days, batchesPerDay, gbSecondsPerBatch, outboundGbPerBatch, extraResponseGbPerBatch]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid cost input');
  }
  for (const value of [nodes, regions, days, batchesPerDay]) if (!Number.isSafeInteger(value)) throw new Error('Invalid count');
  if (monthlyBatchCap !== null && (!Number.isSafeInteger(monthlyBatchCap) || monthlyBatchCap < 0)) throw new Error('Invalid batch cap');
  const requestedBatches = nodes * regions * days * batchesPerDay;
  const batches = monthlyBatchCap === null ? requestedBatches : Math.min(requestedBatches, monthlyBatchCap);
  const compute = batches * gbSecondsPerBatch * prices.gbSecond;
  const requests = batches * 2 * prices.invocation;
  const network = batches * (outboundGbPerBatch + extraResponseGbPerBatch) * prices.outboundGb;
  return { requestedBatches, batches, calls: batches * 2, gbSeconds: batches * gbSecondsPerBatch,
    compute, requests, network, totalCny: compute + requests + network, constrained: batches < requestedBatches };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scenarios = [['current-200-cap', 6, 200], ['paired-8h', 6, null],
    ['every-30m', 48, null], ['every-20m', 72, null], ['every-15m', 96, null], ['every-5m', 288, null]];
  console.log(JSON.stringify({ basis: 'Guangzhou settled one-hour small sample; not Chengdu measurements or a monetary cap', prices, sample,
    scenarios: scenarios.map(([name, batchesPerDay, monthlyBatchCap]) => ({ name, ...estimateCost({ batchesPerDay, monthlyBatchCap }) })) }, null, 2));
}
