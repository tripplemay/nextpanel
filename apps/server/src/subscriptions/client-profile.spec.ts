import { clientProfile } from './client-profile';

describe('subscription client capability selection', () => {
  it.each(['Shadowrocket/2.2.67', 'Shadowrocket/2.2.93 CFNetwork/1 Darwin/1',
    'mihomo/1.19.22', 'Mihomo/v1.19.29', 'Clash.Meta/v1.19.29', 'Xray/26.2.6',
    'v2rayN/7.3.0', 'v2rayN/7.23.1', 'v2rayNG/1.9.24', 'v2rayNG/1.10.0',
    'Shadowrocket/3488 CFNetwork/fixture Darwin/fixture', 'Shadowrocket/3489',
    'clash.meta/alpha-gbc76c13', 'mihomo/alpha-gbc76c13'])('includes XHTTP for %s', ua => {
    expect(clientProfile(undefined, ua)).toBe('xhttp');
    expect(clientProfile('auto', ua)).toBe('xhttp');
    expect(clientProfile('compatible', ua)).toBe('compatible');
  });
  it.each([undefined, null, '', 'Shadowrocket/2.2.66', 'Shadowrocket/2000', 'Shadowrocket',
    'Mihomo/1.19.21', 'Clash/1.18.0', 'ClashForWindows/0.20.39', 'Clash-Verge/2.4.3',
    'sing-box/1.12.0', 'Hiddify/2.0.0', 'HomeProxy/1.0.0', 'v2rayN/6.60.0', 'v2rayNG/1.9.23',
    'curl/8.0.0', 'Mozilla/5.0 Shadowrocket/2.2.93', 'Mihomo/1.19.29-alpha',
    'Shadowrocket/3487', 'Shadowrocket/3488bad', 'clash.meta/alpha-gunknown', 'mihomo/alpha-gbc76c13bad',
    'Mihomo/1.19.29.1', 'Mihomo/1.19.29000', 'Mihomo/1.19.29garbage', 'Mihomo/1.19.29' + ' '.repeat(512),
    ['Mihomo/1.19.29']])('retains compatibility when capability is unknown: %j', ua => {
    expect(clientProfile(undefined, ua)).toBe('compatible');
    expect(clientProfile('auto', ua)).toBe('compatible');
    expect(clientProfile('xhttp', ua)).toBe('xhttp');
  });
  it.each([null, '', 'latest', ['xhttp'], ['auto', 'compatible'], { value: 'auto' }])('rejects ambiguous profile %j', value => {
    expect(() => clientProfile(value, 'Shadowrocket/2.2.93')).toThrow('Invalid client profile');
  });
});
