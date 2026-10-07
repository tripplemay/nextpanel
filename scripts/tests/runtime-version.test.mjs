import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
test('runtime policy matches the lint dependency floor and enforces engines', () => {
  assert.equal(JSON.parse(read('package.json')).engines.node, '^20.19.0 || ^22.13.0 || >=24.0.0');
  assert.match(read('.npmrc'), /^engine-strict=true$/m);
  assert.match(read('scripts/install.sh'), /nodesource\.com\/setup_22\.x/);
});

test('standalone installer rejects unsupported Node versions without changing runtimes', () => {
  const code = read('scripts/install.sh').match(/node -e '([^']+)' \|\| fail "需要 Node\.js/)[1];
  for (const [version, expected] of [
    ['18.20.8', 1], ['20.0.0', 1], ['20.18.3', 1], ['20.19.0', 0], ['20.20.2', 0],
    ['21.7.3', 1], ['22.12.0', 1], ['22.13.0', 0], ['23.11.0', 1], ['24.0.0', 0], ['25.7.0', 0],
  ]) {
    let actual;
    runInNewContext(code, { process: { versions: { node: version }, exit: value => { actual = value; } } });
    assert.equal(actual, expected, version);
  }
});
