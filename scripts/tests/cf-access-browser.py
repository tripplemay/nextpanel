"""CF-only subscription UI fixtures. No production API or external traffic."""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
output = Path('out/ci')
output.mkdir(parents=True, exist_ok=True)
node = {'id': 'cf-node', 'name': 'Telecom fixture', 'protocol': 'VLESS', 'transport': 'WS', 'tls': 'TLS',
        'listenPort': 443, 'domain': 'cdn.example.com', 'cfDnsRecordId': 'record', 'status': 'RUNNING', 'enabled': True,
        'server': {'id': 'entry', 'name': 'entry', 'ip': '192.0.2.90', 'tags': [], 'autoTags': []}}
ordinary = {**node, 'id': 'ordinary', 'name': 'Ordinary fixture', 'transport': 'TCP', 'tls': 'REALITY', 'cfDnsRecordId': None}
external = {'id': 'external', 'name': 'External fixture', 'protocol': 'TROJAN', 'address': '192.0.2.92', 'port': 443}
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in (1440, 390):
        context = browser.new_context(viewport={'width': width, 'height': 1100})
        context.add_init_script(seed)
        page = context.new_page()
        errors, mutations, probes = [], [], []
        state = {'sub': {'id': 's1', 'name': 'Telecom subscription', 'token': 'fixture-owner-token', 'cfOnly': False,
                         'cfPreferredIps': [], 'nodes': [{'node': node}], 'externalNodes': []}, 'fail_probe': False}
        page.on('pageerror', lambda error: errors.append(str(error)))

        def handle(route):
            url = urlparse(route.request.url)
            if url.hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not url.path.startswith('/api/'):
                route.continue_()
            elif url.path == '/api/subscriptions' and route.request.method == 'GET':
                route.fulfill(json=[state['sub']])
            elif url.path == '/api/nodes':
                route.fulfill(json=[node, ordinary])
            elif url.path == '/api/external-nodes':
                route.fulfill(json=[external])
            elif url.path == '/api/subscriptions/cf-access/check':
                assert route.request.method == 'POST'
                probes.append(route.request.post_data_json)
                if state['fail_probe']:
                    route.fulfill(status=400, json={'message': 'Only literal Cloudflare IPv4/IPv6 addresses are allowed'})
                else:
                    route.fulfill(json={'reachable': True, 'latency': 100, 'message': 'fixture OK', 'testedAt': '2026-10-31T00:00:00Z',
                                        'address': '104.16.0.1', 'domain': 'cdn.example.com', 'vantage': 'PANEL',
                                        'audit': {'status': 'UNVERIFIED', 'findings': ['ENTRY_IS_EXIT', 'DNS_HISTORY_AND_FIREWALL_UNVERIFIED']}})
            elif url.path == '/api/subscriptions/cf-access/optimization/cf-node':
                route.fulfill(json={'enabled': False, 'registryError': False, 'rangeError': False,
                                    'rangeUpdatedAt': None, 'profiles': [], 'missingCarriers': ['TELECOM', 'UNICOM', 'MOBILE']})
            elif url.path == '/api/subscriptions/s1':
                assert route.request.method == 'PATCH'
                body = route.request.post_data_json
                mutations.append(body)
                assert 'token' not in body
                state['sub'].update({k: body[k] for k in ('cfOnly', 'cfAuto', 'cfPreferredIps', 'name') if k in body})
                route.fulfill(json=state['sub'])
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)
        page.goto(base + '/subscriptions')
        page.wait_for_load_state('networkidle')
        print(f'START CF access fixture: {width}px; buttons={page.get_by_role("button").all_text_contents()}', flush=True)

        def edit():
            if width < 768:
                page.locator('button').filter(has=page.locator('svg[data-icon="more"]')).click()
                page.get_by_role('menuitem', name='编辑').click()
            else:
                page.locator('button').filter(has_text=re.compile(r'编\s*辑')).click()
            expect(page.get_by_role('dialog')).to_be_visible()

        edit()
        switch = page.get_by_role('switch', name='严格 CF-only', exact=True)
        expect(switch).not_to_be_checked()
        switch.click()
        expect(page.get_by_text('全程 CDN；源站隐藏需独立验收', exact=True)).to_be_visible()
        expect(page.get_by_role('switch', name='CF 自动优选', exact=True)).to_be_checked()
        page.get_by_role('switch', name='CF 自动优选', exact=True).click()
        page.locator('#cfPreferredIps').fill('104.16.0.1')
        page.locator('#cfPreferredIps').press('Enter')
        page.locator('#cfPreferredIps').press('Escape')
        page.get_by_label('检查 CF 节点').click()
        page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='Telecom fixture — cdn.example.com').click()
        page.get_by_label('检查 CF 接入地址').click()
        page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='104.16.0.1').click()
        check_button = page.get_by_role('button', name='检查所选线路与源站风险')
        check_button.click()
        expect(page.get_by_text('源站隐藏：未验收', exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile('入口同时作为出口'))).to_be_visible()
        assert probes == [{'nodeId': 'cf-node', 'ip': '104.16.0.1'}]
        state['fail_probe'] = True
        check_button.click()
        expect(page.get_by_text('Only literal Cloudflare IPv4/IPv6 addresses are allowed', exact=True)).to_be_visible()
        expect(page.get_by_text('源站隐藏：未验收', exact=True)).to_have_count(0)
        state['fail_probe'] = False
        check_button.click()
        expect(page.get_by_text('源站隐藏：未验收', exact=True)).to_be_visible()
        page.screenshot(path=str(output / f'cf-access-{width}.png'), full_page=True)
        page.get_by_role('button', name=re.compile(r'^保\s*存$')).click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        expect(page.get_by_text('1 个节点 · CF-only / 1 条优选', exact=True)).to_be_visible()
        assert mutations[-1]['cfOnly'] is True and mutations[-1]['cfPreferredIps'] == ['104.16.0.1']
        edit()
        expect(page.get_by_role('switch', name='严格 CF-only', exact=True)).to_be_disabled()
        field = page.locator('.ant-form-item').filter(has_text='优选 CF IP（按优先顺序，最多 3 个）')
        field.locator('.ant-select-selection-item-remove').click()
        page.get_by_role('button', name=re.compile(r'^保\s*存$')).click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        assert mutations[-1]['cfOnly'] is True and mutations[-1]['cfPreferredIps'] == []
        edit()
        page.get_by_role('switch', name='CF 自动优选', exact=True).click()
        expect(page.locator('#cfPreferredIps')).to_have_count(0)
        page.get_by_label('检查 CF 节点').click()
        page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text='Telecom fixture — cdn.example.com').click()
        expect(page.get_by_text('后台自动维护未开启，当前仅使用已有安全候选/默认 CDN', exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile('缺少有效实测：电信、联通、移动'))).to_be_visible()
        expect(page.locator('.ant-select-dropdown:visible')).to_have_count(0)
        expect(page.get_by_text('Only literal Cloudflare IPv4/IPv6 addresses are allowed', exact=True)).to_have_count(0)
        page.get_by_text('后台自动维护未开启，当前仅使用已有安全候选/默认 CDN', exact=True).scroll_into_view_if_needed()
        page.screenshot(path=str(output / f'cf-auto-{width}.png'), full_page=True)
        page.get_by_role('button', name=re.compile(r'^保\s*存$')).click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        assert mutations[-1]['cfAuto'] is True and state['sub']['cfPreferredIps'] == []
        expect(page.get_by_text('1 个节点 · CF-only / 自动三网候选', exact=True)).to_be_visible()
        assert state['sub']['token'] == 'fixture-owner-token'
        state['sub'].update({'name': 'AI mixed fixture', 'cfOnly': False, 'cfAuto': False,
                             'nodes': [{'node': node}, {'node': ordinary}], 'externalNodes': [{'externalNode': external}]})
        page.reload()
        page.wait_for_load_state('networkidle')
        edit()
        expect(page.get_by_role('switch', name='CF 自动优选', exact=True)).not_to_be_checked()
        page.get_by_role('switch', name='CF 自动优选', exact=True).click()
        expect(page.get_by_text('混合订阅：仅 CF 节点使用 CDN 优选', exact=True)).to_be_visible()
        expect(page.get_by_text(re.compile('当前 1 个兼容 CF 节点，其他 1 个托管节点和 1 个外部节点保持原样'))).to_be_visible()
        before_mutations = len(mutations)
        page.get_by_role('switch', name='严格 CF-only', exact=True).click()
        expect(page.get_by_text('当前选择不符合严格 CF-only', exact=True)).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^保\s*存$')).click()
        expect(page.get_by_role('dialog')).to_be_visible()
        expect(page.locator('.ant-form-item-explain-error').filter(has_text='外部节点')).to_be_visible()
        assert len(mutations) == before_mutations
        page.get_by_role('switch', name='严格 CF-only', exact=True).click()
        page.get_by_role('button', name=re.compile(r'^保\s*存$')).click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        assert mutations[-1]['cfAuto'] is True and mutations[-1]['cfOnly'] is False
        assert mutations[-1]['nodeIds'] == ['cf-node', 'ordinary'] and mutations[-1]['externalNodeIds'] == ['external']
        expect(page.get_by_text('3 个节点 · 混合订阅 / CF 自动优选', exact=True)).to_be_visible()
        assert state['sub']['token'] == 'fixture-owner-token'
        page.screenshot(path=str(output / f'cf-mixed-{width}.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'viewport overflow'
        assert errors == [], errors
        context.close()
        print(f'PASS CF-only opt-in, candidate check, audit warning, API error, safe rollback, unchanged token: {width}px')
    browser.close()
