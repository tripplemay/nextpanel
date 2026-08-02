import { redactSensitiveAuditValues } from './audit.interceptor';

describe('audit diff redaction', () => {
  it('redacts SOCKS URIs and nested credentials without changing ordinary fields', () => {
    expect(redactSensitiveAuditValues({
      name: 'Chain node',
      socksUri: 'socks://secret@example.com:1080',
      nested: {
        credentials: { username: 'user', password: 'pass' },
        enabled: true,
      },
    })).toEqual({
      name: 'Chain node',
      socksUri: '[REDACTED]',
      nested: {
        credentials: '[REDACTED]',
        enabled: true,
      },
    });
  });
});
