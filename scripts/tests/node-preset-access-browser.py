"""Node creation ingress labels; built preset metadata and synthetic APIs only."""
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
root = Path(__file__).resolve().parents[2]
output = root / 'out/ci'
output.mkdir(parents=True, exist_ok=True)
presets = json.loads(subprocess.check_output([
    'node', '-e',
    "const p = require('./apps/server/dist/nodes/protocols/presets.js');"
    "process.stdout.write(JSON.stringify(p.SUPPORTED_PROTOCOLS.map(value => ({value, ...p.PROTOCOL_PRESETS[value]}))));",
], cwd=root, text=True))
assert len(presets) == 9
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, mode in [(1440, 'light'), (1440, 'dark'), (390, 'light'), (390, 'dark')]:
        context = browser.new_context(viewport={'width': width, 'height': 1050}, service_workers='block')
        context.add_init_script(seed + f"localStorage.setItem('np-theme-mode','{mode}');")
        page = context.new_page()
        errors, mutations = [], []
        state = {'metadata': 'current'}
        page.on('pageerror', lambda error: errors.append(str(error)))

        def handle(route):
            url = urlparse(route.request.url)
            if url.hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not url.path.startswith('/api/'):
                route.continue_()
            elif route.request.method != 'GET':
                mutations.append(url.path)
                route.fulfill(status=400, json={'message': 'Read-only fixture'})
            elif url.path == '/api/nodes/presets':
                data = [dict(preset) for preset in presets]
                if state['metadata'] == 'missing':
                    for preset in data:
                        preset.pop('accessMode')
                elif state['metadata'] == 'unknown':
                    for preset in data:
                        preset['accessMode'] = 'FUTURE_MODE'
                route.fulfill(json=data)
            elif url.path == '/api/servers':
                route.fulfill(json=[{'id': 'server', 'name': 'Fixture', 'ip': '192.0.2.90',
                                     'status': 'ONLINE', 'tags': [], 'autoTags': []}])
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)

        def open_modal():
            page.goto(base + '/nodes')
            page.wait_for_load_state('networkidle')
            page.get_by_role('button', name=re.compile('新增节点$')).first.click()
            dialog = page.get_by_role('dialog')
            expect(dialog).to_be_visible()
            return dialog

        dialog = open_modal()
        expect(dialog.get_by_role('radio', name='单机', exact=True)).to_be_checked()
        expect(dialog.get_by_role('radio', name='直连', exact=True)).to_have_count(0)
        expect(dialog.get_by_text('使用 CF 域名或 TLS 证书，不代表流量经过 CDN。', exact=True)).to_be_visible()
        notice = dialog.get_by_role('status', name='预期接入方式')
        expect(notice).to_have_count(0)

        def select_preset(preset):
            dialog.get_by_label('协议预设', exact=True).click()
            option = page.get_by_role('option').filter(has_text=preset['label'])
            expect(option).to_have_count(1)
            status = 'CDN 保护' if preset['accessMode'] == 'CDN' else '直连'
            expect(option.get_by_text(status, exact=True)).to_be_visible()
            option.click()
            expect(notice.get_by_text(status, exact=True)).to_be_visible()

        for preset in presets:
            select_preset(preset)
            if preset['value'] == 'VLESS_XHTTP_TLS':
                details = dialog.get_by_text('XHTTP 部署与客户端要求 · 不替换网站或 WS', exact=True)
                details.click()
                expect(dialog.get_by_text(re.compile('自动检测端口'))).to_be_visible()
                expect(dialog.get_by_text(re.compile('Origin Rules 权限'))).to_be_visible()
                details.click()
                expect(dialog.get_by_text(re.compile('自动检测端口'))).to_be_hidden()
            else:
                expect(notice).to_contain_text(preset['description'])
            if preset['accessMode'] == 'CDN':
                expect(notice).to_contain_text('客户端 → Cloudflare CDN → 服务器')
                expect(notice).to_contain_text('待部署验证')
                expect(notice).to_contain_text('选择预设不代表已受保护')
                expect(notice).to_contain_text('同一 IP 上是否存在直连节点或 DNS-only 记录')
            else:
                expect(notice).to_contain_text('客户端 → 服务器')
                expect(notice).to_contain_text('服务器公网 IP 对客户端可见')
                expect(notice.get_by_text('CDN 保护', exact=True)).to_have_count(0)
            if preset['value'] in ('ANYTLS', 'TUIC_V5'):
                expect(notice).to_contain_text('仅用于 DNS 解析和证书验证，不经过 CDN')
            if preset['value'] in ('ANYTLS', 'VLESS_WS_TLS', 'VLESS_XHTTP_TLS'):
                notice.scroll_into_view_if_needed()
                page.screenshot(path=str(output / f'node-access-{preset["value"]}-{width}-{mode}.png'),
                                full_page=True, animations='disabled')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'viewport overflow'
            assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), 'dialog overflow'

        for value in ('ANYTLS', 'VLESS_WS_TLS'):
            preset = next(item for item in presets if item['value'] == value)
            select_preset(preset)
            dialog.get_by_text('链式', exact=True).click()
            expect(dialog.get_by_role('radio', name='链式', exact=True)).to_be_checked()
            expected = ('客户端 → Cloudflare CDN → 入口服务器 → 出口' if preset['accessMode'] == 'CDN'
                        else '客户端 → 入口服务器 → 出口')
            expect(notice).to_contain_text(expected)
            dialog.get_by_text('单机', exact=True).click()
            expect(dialog.get_by_role('radio', name='单机', exact=True)).to_be_checked()
            expect(notice).not_to_contain_text('入口服务器')

        for metadata in ('missing', 'unknown'):
            state['metadata'] = metadata
            dialog.get_by_role('button', name='Close', exact=True).click()
            dialog = open_modal()
            dialog.get_by_label('协议预设', exact=True).click()
            option = page.get_by_role('option').filter(has_text='VLESS + WS + TLS')
            expect(option.get_by_text('接入方式待确认', exact=True)).to_be_visible()
            option.click()
            expect(notice).to_contain_text('接入方式待确认')
            expect(notice.get_by_text('CDN 保护', exact=True)).to_have_count(0)
            expect(notice.get_by_text('直连', exact=True)).to_have_count(0)

        assert not errors, errors
        assert not mutations, mutations
        context.close()
        print(f'PASS all 9 presets, chain ingress, pending protection, unknown metadata, no mutations: {width}px {mode}')
    browser.close()
