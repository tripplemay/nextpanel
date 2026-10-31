const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const directory = process.argv[2];
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, 'localhost');
assert.ok(database.searchParams.get('host')?.includes('/np-pg-'), 'Isolated fixture database required');
const req = createRequire(path.join(directory, 'package.json'));
const nativeFetch = global.fetch;
global.fetch = async () => { throw new Error('Outbound requests disabled in bootstrap fixture'); };
const { NestFactory } = req('@nestjs/core');
const { ValidationPipe } = req('@nestjs/common');
const { AppModule } = req(path.join(directory, 'dist/app.module.js'));
const { configureBodyParsers } = req(path.join(directory, 'dist/common/http/body-parsers.js'));
async function main() {
  const app = await NestFactory.create(AppModule, { rawBody: true, logger: false });
  try {
    configureBodyParsers(app);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api`;
    assert.equal((await nativeFetch(`${base}/health/ready`)).status, 200);
    assert.equal((await nativeFetch(`${base}/servers`)).status, 401);
    const login = await nativeFetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nonexistent-bootstrap-fixture', password: 'fixture-password' }) });
    assert.equal(login.status, 401, 'Real application login must parse JSON before authentication');
    console.log('Compiled application bootstrap, readiness, auth and JSON parsing PASS');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
