import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { WxWorkSettingsService } from './wxwork-settings.service';

interface WxWorkAccessToken {
  access_token: string;
  expires_in: number;
}

interface WxWorkUserTicket {
  UserId?: string;
  userid?: string;
  user_ticket?: string;
  errcode?: number;
  errmsg?: string;
}

interface WxWorkUserInfo {
  userid: string;
  name: string;
  errcode: number;
  errmsg: string;
}

@Injectable()
export class WxWorkService {
  private readonly logger = new Logger(WxWorkService.name);

  // Access token cache
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(private readonly settings: WxWorkSettingsService) {}

  /** Build the OAuth login URL based on device type */
  async getLoginUrl(redirectUri: string, state: string, device: 'desktop' | 'mobile'): Promise<string> {
    const config = await this.settings.getDecrypted();
    if (!config) throw new BadRequestException('企业微信未配置');

    const encodedRedirect = encodeURIComponent(redirectUri);

    if (device === 'mobile') {
      // Mobile: OAuth2 redirect flow (opens WeChat Work app)
      return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${config.corpId}&redirect_uri=${encodedRedirect}&response_type=code&scope=snsapi_privateinfo&state=${state}&agentid=${config.agentId}#wechat_redirect`;
    }

    // Desktop: QR code scan flow
    return `https://open.work.weixin.qq.com/wwopen/sso/qrConnect?appid=${config.corpId}&agentid=${config.agentId}&redirect_uri=${encodedRedirect}&state=${state}`;
  }

  /** Exchange authorization code for user info */
  async getUserByCode(code: string): Promise<{ userId: string; name: string }> {
    const config = await this.settings.getDecrypted();
    if (!config) throw new BadRequestException('企业微信未配置');

    // Step 1: Get access_token
    const accessToken = await this.getAccessToken(config);

    // Step 2: Get userId from code
    const userTicket = await this.fetchJson<WxWorkUserTicket>(
      `https://qyapi.weixin.qq.com/cgi-bin/auth/getuserinfo?access_token=${accessToken}&code=${code}`,
      config.proxyUrl,
    );
    // WeChat Work API returns UserId (capital U) or userid depending on version
    const wxUserId = userTicket.UserId ?? userTicket.userid;
    if (!wxUserId) {
      this.logger.error(`getuserinfo response: ${JSON.stringify(userTicket)}`);
      throw new BadRequestException(`企业微信授权失败：无法获取用户ID（errcode: ${userTicket.errcode}, errmsg: ${userTicket.errmsg}）`);
    }

    // Step 3: Get user detail
    const userInfo = await this.fetchJson<WxWorkUserInfo>(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${wxUserId}`,
      config.proxyUrl,
    );
    if (userInfo.errcode !== 0) {
      this.logger.error(`WeChat Work user info error: ${userInfo.errmsg}`);
      throw new BadRequestException(`企业微信获取用户信息失败：${userInfo.errmsg}`);
    }

    return { userId: userInfo.userid, name: userInfo.name };
  }

  /** Check if wxwork is configured */
  isConfigured(): Promise<boolean> {
    return this.settings.isConfigured();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async getAccessToken(config: { corpId: string; secret: string; proxyUrl: string | null }): Promise<string> {
    // Return cached token if still valid (with 5-minute buffer)
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 300_000) {
      return this.tokenCache.token;
    }

    const data = await this.fetchJson<WxWorkAccessToken>(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpId}&corpsecret=${config.secret}`,
      config.proxyUrl,
    );

    if (!data.access_token) {
      throw new BadRequestException('企业微信获取 access_token 失败');
    }

    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return data.access_token;
  }

  private async fetchJson<T>(url: string, proxyUrl: string | null | undefined): Promise<T> {
    // If proxy configured, set HTTPS_PROXY for this request
    const prevProxy = process.env.HTTPS_PROXY;
    if (proxyUrl) {
      process.env.HTTPS_PROXY = proxyUrl;
      process.env.HTTP_PROXY = proxyUrl;
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new BadRequestException(`企业微信 API 请求失败：HTTP ${res.status}`);
      }
      return res.json() as Promise<T>;
    } finally {
      // Restore original proxy env
      if (proxyUrl) {
        if (prevProxy) {
          process.env.HTTPS_PROXY = prevProxy;
          process.env.HTTP_PROXY = prevProxy;
        } else {
          delete process.env.HTTPS_PROXY;
          delete process.env.HTTP_PROXY;
        }
      }
    }
  }
}
