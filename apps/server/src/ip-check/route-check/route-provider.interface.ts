export interface InboundNode {
  isp: string;
  city: string;
  pingMs: number;  // -1 = unreachable
  loss: number;    // packet loss %
  source: string;  // provider name, e.g. "itdog"
}

export interface RouteProvider {
  readonly name: string;
  /** Returns inbound ping latency from 9 Chinese ISP nodes to `ip`. */
  checkInbound(ip: string): Promise<InboundNode[]>;
}
