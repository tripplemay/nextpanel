import type { RouteProvider, InboundNode } from '../route-provider.interface';

// ping.chinaz.com node mapping for target ISP+city combinations
const CHINAZ_NODES: { id: string; isp: string; city: string }[] = [
  { id: 'telecom-beijing',  isp: '电信', city: '北京' },
  { id: 'telecom-shanghai', isp: '电信', city: '上海' },
  { id: 'telecom-guangz',   isp: '电信', city: '广州' },
  { id: 'unicom-beijing',   isp: '联通', city: '北京' },
  { id: 'unicom-shanghai',  isp: '联通', city: '上海' },
  { id: 'unicom-guangz',    isp: '联通', city: '广州' },
  { id: 'cmcc-beijing',     isp: '移动', city: '北京' },
  { id: 'cmcc-shanghai',    isp: '移动', city: '上海' },
  { id: 'cmcc-guangz',      isp: '移动', city: '广州' },
];

interface ChinazResult {
  id: string;
  time: number; // ms, -1 if unreachable
  loss: number; // 0-100
}

interface ChinazResponse {
  code: number;
  data: ChinazResult[];
}

export class ChinazProvider implements RouteProvider {
  readonly name = 'chinaz';

  async checkInbound(ip: string): Promise<InboundNode[]> {
    const nodeIds = CHINAZ_NODES.map((n) => n.id).join(',');
    const url = `https://api.ping.chinaz.com/ping?host=${encodeURIComponent(ip)}&nodes=${nodeIds}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ping.chinaz.com/',
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) throw new Error(`chinaz returned ${res.status}`);

    const body = await res.json() as ChinazResponse;
    if (body.code !== 0 || !Array.isArray(body.data)) {
      throw new Error(`chinaz unexpected response: code=${body.code}`);
    }

    const resultMap = new Map<string, ChinazResult>(body.data.map((r) => [r.id, r]));

    return CHINAZ_NODES.map((node) => {
      const r = resultMap.get(node.id);
      return {
        isp: node.isp,
        city: node.city,
        pingMs: r ? r.time : -1,
        loss: r ? r.loss : 100,
        source: this.name,
      };
    });
  }
}
