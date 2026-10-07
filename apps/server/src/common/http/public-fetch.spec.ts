import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { lookup } from 'dns/promises';
import { request } from 'https';
import { fetchPublicText, isPublicAddress } from './public-fetch';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('https', () => ({ request: jest.fn() }));

describe('public URL fetch boundary', () => {
  beforeEach(() => jest.resetAllMocks());
  it.each(['127.0.0.1', '0.0.0.0', '10.2.3.4', '172.31.1.1', '192.168.0.1',
    '169.254.169.254', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:8.8.8.8',
    'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1'])('rejects non-public %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888'])('allows global %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
  it.each(['http://2130706433', 'http://0x7f000001', 'http://[::1]', 'file:///etc/passwd', 'https://user:pass@public.test'])('rejects URL %s before opening a socket', async (url) => {
    await expect(fetchPublicText(url)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private DNS answers', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    await expect(fetchPublicText('https://mixed.test')).rejects.toThrow('非公网');
    expect(request).not.toHaveBeenCalled();
  });

  function remote(status: number, headers: Record<string, string>, body: string) {
    (request as jest.Mock).mockImplementationOnce((_url, options, callback) => {
      const req = new EventEmitter() as any;
      req.destroy = (error: Error) => { req.emit('error', error); req.emit('close'); };
      req.end = () => queueMicrotask(() => {
        const res = new PassThrough() as any;
        res.statusCode = status; res.headers = headers;
        callback(res);
        res.end(body);
        res.on('end', () => req.emit('close'));
      });
      return req;
    });
  }
  it('pins the checked DNS answer in the actual socket lookup', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    remote(200, {}, 'subscription');
    await expect(fetchPublicText('https://public.test')).resolves.toBe('subscription');
    const options = (request as jest.Mock).mock.calls[0][1];
    const callback = jest.fn();
    options.lookup('public.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(options.agent).toBe(false);
  });
  it('validates every redirect rather than following to metadata services', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    remote(302, { location: 'http://169.254.169.254/latest/meta-data/' }, '');
    await expect(fetchPublicText('https://public.test')).rejects.toThrow('非公网');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('limits streamed bodies even without Content-Length', async () => {
    (lookup as jest.Mock).mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    remote(200, {}, 'oversized');
    await expect(fetchPublicText('https://public.test', { maxBytes: 3 })).rejects.toThrow('大小');
  });
  it('bounds DNS resolution time', async () => {
    (lookup as jest.Mock).mockReturnValue(new Promise(() => {}));
    await expect(fetchPublicText('https://public.test', { timeoutMs: 5 })).rejects.toThrow('超时');
  });
});
