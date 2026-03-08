import type { RouteProvider, InboundNode } from '../route-provider.interface';

// Known itdog node IDs for the 9 target ISP+city combinations.
// Each entry maps to itdog's internal measurement node.
const ITDOG_NODES: { id: number; isp: string; city: string }[] = [
  { id: 1,  isp: '联通', city: '北京' },
  { id: 2,  isp: '联通', city: '上海' },
  { id: 3,  isp: '联通', city: '广州' },
  { id: 4,  isp: '电信', city: '北京' },
  { id: 5,  isp: '电信', city: '上海' },
  { id: 6,  isp: '电信', city: '广州' },
  { id: 7,  isp: '移动', city: '北京' },
  { id: 8,  isp: '移动', city: '上海' },
  { id: 9,  isp: '移动', city: '广州' },
];

interface ItdogNodeResult {
  node_id: number;
  loss: number;       // packet loss %
  avg_delay: number;  // average ping ms
}

interface ItdogResponse {
  code: number;
  data: ItdogNodeResult[];
}

export class ItdogProvider implements RouteProvider {
  readonly name = 'itdog';

  async checkInbound(ip: string): Promise<InboundNode[]> {
    const nodeIds = ITDOG_NODES.map((n) => n.id).join(',');
    const url = `https://api.itdog.cn/ping?ip=${encodeURIComponent(ip)}&node_id=${nodeIds}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.itdog.cn/',
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) throw new Error(`itdog returned ${res.status}`);

    const body = await res.json() as ItdogResponse;
    if (body.code !== 0 || !Array.isArray(body.data)) {
      throw new Error(`itdog unexpected response: code=${body.code}`);
    }

    const resultMap = new Map<number, ItdogNodeResult>(body.data.map((r) => [r.node_id, r]));

    return ITDOG_NODES.map((node) => {
      const r = resultMap.get(node.id);
      return {
        isp: node.isp,
        city: node.city,
        pingMs: r ? r.avg_delay : -1,
        loss: r ? r.loss : 100,
        source: this.name,
      };
    });
  }
}
