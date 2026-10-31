import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';

export function configureBodyParsers(app: NestExpressApplication) {
  app.use('/api/agent/heartbeat', json({ limit: '2mb', verify: (req, _res, buffer) => {
    (req as { rawBody?: Buffer }).rawBody = buffer;
  } }));
  // Nest deduplicates parsers by function name, not mount path. Install the
  // ordinary parser explicitly so the scoped one cannot suppress it at init.
  app.useBodyParser('json', { limit: '100kb' });
}
