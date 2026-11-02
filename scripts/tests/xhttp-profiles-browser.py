"""XHTTP profile create/edit flows. All API requests are synthetic and local."""
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
presets = json.loads(subprocess.check_output(['node', '-e',
    "const p=require('./apps/server/dist/nodes/protocols/presets.js');"
    "process.stdout.write(JSON.stringify(p.SUPPORTED_PROTOCOLS.map(value=>({value,...p.PROTOCOL_PRESETS[value]}))));"],
    cwd=root, text=True))
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, theme in [(1440, 'light'), (390, 'dark')]:
        context = browser.new_context(viewport={'width': width, 'height': 1050}, service_workers='block')
        context.add_init_script(seed + f"localStorage.setItem('np-theme-mode','{theme}');")
        page = context.new_page()
        errors, writes = [], []
        state = {'h3': False, 'mode': 'packet-up', 'credential_error': False}
        servers = [{'id': sid, 'name': sid, 'ip': '192.0.2.90', 'status': 'ONLINE', 'tags': [], 'autoTags': []}
                   for sid in ('entry', 'exit')]
        node = {'id': 'pilot', 'name': 'CDN pilot', 'serverId': 'entry', 'server': servers[0], 'protocol': 'VLESS',
                'implementation': 'XRAY', 'transport': 'XHTTP', 'tls': 'TLS', 'listenPort': 443,
                'domain': 'cdn.example.com', 'enabled': True, 'status': 'RUNNING', 'statsPort': None,
                'trafficUpBytes': 0, 'trafficDownBytes': 0}
        page.on('pageerror', lambda error: errors.append(str(error)))

        def handle(route):
            path = urlparse(route.request.url).path
            if urlparse(route.request.url).hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not path.startswith('/api/'):
                route.continue_()
            elif route.request.method != 'GET':
                assert path in ('/api/nodes/preset', '/api/nodes/chain', '/api/nodes/pilot'), path
                body = route.request.post_data_json
                writes.append((path, body))
                if path == '/api/nodes/pilot':
                    state['mode'] = body.get('xhttpMode', state['mode'])
                    route.fulfill(json=node)
                else:
                    route.fulfill(status=400, json={'message': 'Fixture request captured'})
            elif path == '/api/nodes/presets':
                route.fulfill(json=presets)
            elif path == '/api/servers':
                route.fulfill(json=servers)
            elif path == '/api/nodes':
                route.fulfill(json=[node])
            elif path == '/api/nodes/pilot/credentials':
                if state['credential_error']:
                    route.fulfill(status=400, json={'message': 'Fixture credentials unavailable'})
                else:
                    route.fulfill(json={'uuid': '00000000-0000-4000-8000-000000000001', 'path': '/fixture',
                                        'xhttpMode': state['mode'], 'xhttpAlpn': 'h3' if state['h3'] else 'h2'})
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)

        def load():
            page.goto(base + '/nodes')
            page.reload()
            page.wait_for_load_state('networkidle')

        def choose(label, text):
            page.get_by_label(label, exact=True).click()
            page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter(has_text=text).click()
            expect(page.locator('.ant-select-dropdown:visible')).to_have_count(0)

        def create(chain=False):
            load()
            page.get_by_role('button', name=re.compile('新增节点$')).first.click()
            dialog = page.get_by_role('dialog')
            if chain:
                dialog.get_by_text('链式', exact=True).click()
                choose('入口服务器', 'entry')
                choose('出口服务器', 'exit')
            else:
                choose('服务器', 'entry')
            return dialog

        for chain in (False, True):
            dialog = create(chain)
            choose('协议预设', 'VLESS + XHTTP + H2 + TLS')
            choose('XHTTP 上传模式', 'stream-up')
            expect(dialog).to_contain_text('需开启 CF gRPC')
            expect(dialog).to_contain_text('API 无法读取该开关')
            dialog.get_by_label('节点名称', exact=True).fill('fixture-stream')
            dialog.get_by_role('button', name='确 定').click()
            expect(page.get_by_text('Fixture request captured', exact=True)).to_be_visible()
            assert writes[-1][1]['xhttpMode'] == 'stream-up'
            assert writes[-1][0] == ('/api/nodes/chain' if chain else '/api/nodes/preset')
            if not chain:
                choose('协议预设', 'VLESS + XHTTP + HTTP/3 + TLS')
                expect(dialog.get_by_label('XHTTP 上传模式', exact=True)).to_have_count(0)
                expect(dialog).to_contain_text('不开放源站 UDP')
                dialog.get_by_role('button', name='确 定').click()
                expect(page.get_by_text('Fixture request captured', exact=True).last).to_be_visible()
                page.wait_for_load_state('networkidle')
                assert writes[-1][1]['preset'] == 'VLESS_XHTTP_H3_TLS'
                assert 'xhttpMode' not in writes[-1][1], 'stale hidden H2 mode leaked into H3 request'
            dialog.get_by_role('button', name='Close', exact=True).click()

        def edit():
            load()
            page.locator('button').filter(has=page.locator('[aria-label="ellipsis"]')).first.click()
            page.get_by_role('menuitem', name='XHTTP 传输设置').click()
            dialog = page.get_by_role('dialog')
            expect(dialog.get_by_text('编辑 CDN XHTTP 节点', exact=True)).to_be_visible()
            return dialog

        dialog = edit()
        expect(dialog).to_contain_text('HTTP/2 · CDN 接入')
        choose('XHTTP 上传模式', 'stream-up')
        expect(dialog).to_contain_text('切换模式后必须更新客户端订阅')
        expect(dialog).to_contain_text('API 无法读取该开关')
        expect(dialog).to_contain_text('部署时验证真实 CDN 链路，失败回滚')
        expect(dialog.get_by_label('UUID', exact=True)).to_have_count(0)
        dialog.get_by_role('button', name='确 定').click()
        expect(dialog).to_be_hidden()
        assert writes[-1] == ('/api/nodes/pilot', {'name': 'CDN pilot', 'enabled': True, 'xhttpMode': 'stream-up'})
        dialog = edit()
        expect(dialog.get_by_text('stream-up · 持续流式上传', exact=True)).to_be_visible()
        dialog.get_by_role('button', name='Close', exact=True).click()
        state.update(h3=True, mode='packet-up')
        dialog = edit()
        expect(dialog).to_contain_text('HTTP/3 · CDN 接入')
        expect(dialog.get_by_label('XHTTP 上传模式', exact=True)).to_be_disabled()
        expect(dialog).not_to_have_class(re.compile('.*zoom-.*(?:active|prepare).*'))
        expect(dialog).to_have_css('opacity', '1')
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        assert dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1')
        output = root / 'out/ci'
        output.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(output / f'xhttp-profile-edit-{width}-{theme}.png'), full_page=True, animations='disabled')
        dialog.get_by_role('button', name='Close', exact=True).click()
        state['credential_error'] = True
        dialog = edit()
        expect(dialog.get_by_role('button', name='确 定')).to_be_disabled()
        assert not errors, errors
        context.close()
        print(f'PASS direct/chain create, hidden-mode isolation, transactional edit payload, H3/read-error guard: {width}px {theme}')
    browser.close()
