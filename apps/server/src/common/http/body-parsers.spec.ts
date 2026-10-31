import { Body, Controller, Module, Post, RawBodyRequest, Req, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request } from 'express';
import { IsString } from 'class-validator';
import { configureBodyParsers } from './body-parsers';

class PayloadDto { @IsString() value!: string; }
@Controller()
class BodyFixtureController {
  @Post(['auth/login', 'subscriptions/update', 'agent/heartbeat'])
  echo(@Body() body: PayloadDto, @Req() request: RawBodyRequest<Request>) {
    return { value: body.value, rawBytes: request.rawBody?.length };
  }
}
@Module({ controllers: [BodyFixtureController] })
class BodyFixtureModule {}

describe('production bootstrap JSON parsing', () => {
  let app: NestExpressApplication; let base: string;
  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(BodyFixtureModule, { rawBody: true, logger: false });
    configureBodyParsers(app);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => app?.close());
  const send = (route: string, body: string, contentType = 'application/json') => fetch(`${base}/api/${route}`, {
    method: 'POST', headers: { 'Content-Type': contentType }, body,
  });
  it.each(['auth/login','subscriptions/update'])('parses ordinary JSON and preserves raw body on %s', async route => {
    const body = JSON.stringify({ value: 'fixture' }); const response = await send(route, body);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ value: 'fixture', rawBytes: Buffer.byteLength(body) });
  });
  it('retains the default ordinary JSON size limit', async () => {
    expect((await send('auth/login', JSON.stringify({ value: 'a'.repeat(120_000) }))).status).toBe(413);
  });
  it('accepts bounded large heartbeats without raising other route limits', async () => {
    const body = JSON.stringify({ value: 'a'.repeat(150_000) });
    const response = await send('agent/heartbeat', body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ rawBytes: Buffer.byteLength(body) });
    expect((await send('agent/heartbeat', JSON.stringify({ value: 'a'.repeat(2 * 1024 * 1024) }))).status).toBe(413);
  });
  it('keeps form parsing and malformed JSON/DTO rejection intact', async () => {
    expect((await send('auth/login','value=fixture','application/x-www-form-urlencoded')).status).toBe(201);
    expect((await send('auth/login','{"value":')).status).toBe(400);
    expect((await send('auth/login','{"value":"fixture","unexpected":true}')).status).toBe(400);
  });
});
