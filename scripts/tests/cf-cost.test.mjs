import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, sample } from '../cf-probe/estimate-cost.mjs';

test('cost estimate reproduces the settled sample without multiplying candidate count into function calls', () => {
  const cost = estimateCost({ nodes: 4, regions: 1, days: 1, batchesPerDay: 2 });
  assert.equal(cost.calls, sample.calls);
  assert.equal(cost.gbSeconds, sample.gbSeconds);
  assert.ok(Math.abs(cost.totalCny - 0.00631112) < 0.00000001);
});
test('regional scaling and quota truncation remain explicit', () => {
  const cost = estimateCost();
  assert.equal(cost.batches, 23040); assert.equal(cost.calls, 46080);
  assert.ok(cost.totalCny > 18 && cost.totalCny < 19);
  assert.equal(estimateCost({ regions: 1 }).totalCny * 2, cost.totalCny);
  const capped = estimateCost({ monthlyBatchCap: 200 });
  assert.equal(capped.batches, 200); assert.equal(capped.requestedBatches, 23040); assert.equal(capped.constrained, true);
  assert.equal(estimateCost({ monthlyBatchCap: 0 }).totalCny, 0);
  assert.throws(() => estimateCost({ days: NaN }));
  assert.throws(() => estimateCost({ nodes: 1.5 }));
});
