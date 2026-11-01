"""CDN XHTTP compatibility UI. Synthetic API only; no production traffic."""
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
output = Path('out/ci')
output.mkdir(parents=True, exist_ok=True)
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, mode in [(1440, 'light'), (390, 'dark')]:
        context = browser.new_context(viewport={'width': width, 'height': 1050})
        context.add_init_script(seed + f"localStorage.setItem('np-theme-mode','{mode}');")
        page = context.new_page()
        errors, mutations = [], []
        state = {'gate': False}
        node = {'id': 'pilot', 'name': 'CDN pilot', 'protocol': 'VLESS', 'transport': 'XHTTP', 'tls': 'TLS',
                'listenPort': 443, 'domain': 'cdn.example.com', 'cfDnsRecordId': 'record', 'status': 'RUNNING', 'enabled': True,
                'statsPort': None, 'trafficUpBytes': 0, 'trafficDownBytes': 0,
                'server': {'id': 'server', 'name': 'Fixture', 'ip': '192.0.2.90', 'tags': [], 'autoTags': []}}
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
            elif url.path == '/api/subscriptions':
                route.fulfill(json=[{'id': 's1', 'name': 'CDN pilot', 'token': 'fixture-owner', 'cfOnly': True,
                                     'cfAuto': True, 'cfPreferredIps': [], 'nodes': [{'node': node}], 'externalNodes': []}])
            elif url.path == '/api/servers':
                route.fulfill(json=[{'id': 'server', 'name': 'Fixture', 'ip': '192.0.2.90', 'status': 'ONLINE', 'tags': [], 'autoTags': []}])
            elif url.path == '/api/nodes':
                route.fulfill(json=[{**node, 'serverId': 'server', 'listenPort': 8443, 'publicPort': 443,
                    'cfOriginRoute': {'state': 'READY', 'port': 8443, 'ruleId': 'fixture-rule', 'rulesetId': 'fixture-set',
                        'checkedAt': datetime.now(timezone.utc).isoformat(), 'domain': node['domain']}}])
            elif url.path == '/api/nodes/presets':
                route.fulfill(json=[{'value': 'VLESS_WS_TLS', 'label': 'VLESS + WS + TLS', 'description': 'Existing compatibility path'},
                                    {'value': 'VLESS_XHTTP_TLS', 'label': 'VLESS + XHTTP + TLS (CDN 试点)',
                                     'description': 'Isolated pilot', 'disabled': not state['gate']}])
            elif url.path.startswith('/api/subscriptions/cf-access/optimization/'):
                route.fulfill(json={'enabled': False, 'profiles': [], 'missingRegions': []})
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)
        page.goto(base + '/subscriptions')
        page.wait_for_load_state('networkidle')
        expect(page.get_by_text('CDN pilot', exact=True).first).to_be_visible()
        page.get_by_role('button', name='导出 CDN pilot 的订阅链接', exact=True).click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()

        def select_tab(name):
            tab = dialog.get_by_role('tab', name=name, exact=True)
            tab = page.locator('#' + tab.get_attribute('id'))
            # Keyboard activation stays reliable while the overflow strip scrolls on focus.
            tab.focus()
            tab.press('Enter')
            expect(tab).to_have_attribute('aria-selected', 'true')
            return page.locator('#' + tab.get_attribute('aria-controls'))

        compatible = base + '/api/subscriptions/link/fixture-owner'
        for label, suffix in [('Clash / OpenClash', '/clash'), ('Shadowrocket / Base64', '')]:
            panel = select_tab(label)
            expect(panel.get_by_text(compatible + suffix, exact=True)).to_be_visible()
            assert '?profile=' not in panel.inner_text()
        panel = select_tab('XHTTP · 试点')
        expect(panel.get_by_text(compatible + '/clash?profile=xhttp', exact=True)).to_be_visible()
        expect(panel.get_by_text(compatible + '?profile=xhttp', exact=True)).to_be_visible()
        expect(panel.get_by_text(re.compile('原链接和 WS 服务仍保留'))).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=str(output / f'cf-xhttp-links-{width}-{mode}.png'), full_page=True, animations='disabled')
        page.keyboard.press('Escape')
        expect(dialog).to_be_hidden()

        if width == 1440:
            page.get_by_role('button', name=re.compile('编辑$')).click()
            expect(dialog).to_be_visible()
            dialog.get_by_label('检查 CF 节点', exact=True).click()
            page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='CDN pilot').click()
            expect(dialog.get_by_text(re.compile('不兼容严格 CF-only'))).to_have_count(0)
            dialog.get_by_role('button', name='Close', exact=True).click()
            expect(dialog).to_be_hidden()

        for gate in (False, True):
            state['gate'] = gate
            page.goto(base + '/nodes')
            page.reload()
            page.wait_for_load_state('networkidle')
            if errors:
                page.screenshot(path=str(output / f'cf-origin-ui-error-{width}.png'), full_page=True)
                raise AssertionError(errors)
            try:
                page.get_by_role('button', name=re.compile('新增节点$')).first.click(timeout=10000)
            except Exception:
                page.screenshot(path=str(output / f'cf-origin-ui-error-{width}.png'), full_page=True)
                print(page.url, page.locator('body').inner_text(), errors)
                raise
            expect(dialog).to_be_visible()
            page.get_by_label('协议预设', exact=True).click()
            option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='VLESS + XHTTP + TLS (CDN 试点)')
            if gate:
                option.click()
                page.get_by_label('节点名称', exact=True).click()
                expect(page.locator('.ant-select-dropdown:visible')).to_have_count(0)
                expect(dialog.get_by_text(re.compile('自动检测端口'))).to_be_visible()
                page.screenshot(path=str(output / f'cf-xhttp-preset-{width}-{mode}.png'), full_page=True, animations='disabled')
            else:
                expect(option).to_have_class(re.compile('ant-select-item-option-disabled'))
                page.keyboard.press('Escape')
            dialog.get_by_role('button', name='Close', exact=True).click()
            expect(dialog).to_be_hidden()
        page.get_by_role('button', name='查看 CDN pilot 回源端口映射', exact=True).click()
        expect(page.get_by_text('Cloudflare 回源映射', exact=True)).to_be_visible()
        expect(page.get_by_text('原 443 网站或 WS 服务保持不变。', exact=True)).to_be_visible()
        expect(page.get_by_text('回源规则：已登记', exact=True)).to_be_visible()
        popup = page.locator('.ant-popover').filter(has_text='Cloudflare 回源映射')
        expect(popup).not_to_have_class(re.compile('zoom-big-.*(?:active|prepare)'))
        expect(popup).to_have_css('opacity', '1')
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        page.screenshot(path=str(output / f'cf-origin-status-{width}-{mode}.png'), full_page=True, animations='disabled')
        assert not mutations, mutations
        assert not errors, errors
        context.close()
        print(f'PASS CDN XHTTP profiles, unchanged compatibility links, gated preset, no mutations: {width}px {mode}')
    browser.close()
