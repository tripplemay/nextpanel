import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../', import.meta.url)) });
for (const filePath of ['apps/server/src/lint-fixture.ts', 'apps/web/src/lint-fixture.tsx', 'packages/shared/src/lint-fixture.ts']) {
  test(`lint enforces correctness in ${filePath}`, async () => {
    const [bad] = await eslint.lintText('export const value = {} || "unreachable";', { filePath });
    assert.ok(bad.messages.some(m => m.ruleId === 'no-constant-binary-expression' && m.severity === 2));
    const [good] = await eslint.lintText('export const value: number = 1;', { filePath });
    assert.equal(good.errorCount, 0);
    assert.equal(good.warningCount, 0);
  });
}

test('frontend gate rejects conditional hooks', async () => {
  const [result] = await eslint.lintText(
    "import { useState } from 'react'; export function Panel({ enabled }) { if (enabled) useState(0); return null; }",
    { filePath: 'apps/web/src/lint-fixture.tsx' },
  );
  assert.ok(result.messages.some(m => m.ruleId === 'react-hooks/rules-of-hooks' && m.severity === 2));
});
