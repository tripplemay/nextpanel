"""Local fixture-only resource lifecycle UI checks; all external requests are blocked."""
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
output = Path('out/ci')
output.mkdir(parents=True, exist_ok=True)
server = {'id': 'active', 'name': 'Active fixture', 'ip': '192.0.2.1', 'status': 'ONLINE',
          'region': 'test', 'provider': 'test', 'tags': [], 'nodeCount': 0}
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in (1440, 390):
        context = browser.new_context(viewport={'width': width, 'height': 1000})
        context.add_init_script(seed)
        page = context.new_page()
        errors, mutations = [], []
        state = {'task': 'BLOCKED', 'fail_list': False, 'hidden': False}
        page.on('pageerror', lambda error: errors.append(str(error)))

        def handle(route):
            url = urlparse(route.request.url)
            if url.hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not url.path.startswith('/api/'):
                route.continue_()
            elif url.path == '/api/servers':
                pending = {**server, 'id': 'pending', 'name': 'Pending deletion', 'status': 'DELETING', 'deleteError': 'Final inventory unavailable'}
                route.fulfill(json=[server] if state['hidden'] else [server, pending])
            elif url.path == '/api/servers/pending':
                assert route.request.method == 'DELETE' and url.query == 'force=true'
                mutations.append(url.path)
                state['hidden'] = True
                route.fulfill(json={'status': 'DELETING', 'cleanupPending': True, 'retired': True})
            elif url.path == '/api/resources':
                if state['fail_list']:
                    route.fulfill(status=503, json={'message': 'fixture unavailable'})
                else:
                    route.fulfill(json={
                        'tasks': [{'id': 'cleanup', 'serverId': 'retired', 'serverName': 'Retired entry',
                                   'nodeName': 'Fixture chain', 'role': 'ENTRY', 'state': state['task'], 'attempts': 3,
                                   'lastError': 'Ownership mismatch' if state['task'] == 'BLOCKED' else None}],
                        'findings': [{'id': 'finding', 'serverId': 'active', 'serviceName': 'nextpanel-chain-old',
                                      'detail': 'Unknown service', 'lastSeenAt': '2026-10-31T00:00:00Z'}],
                        'retirements': [{'id': 'retired', 'name': 'Retired entry', 'deleteError': 'Final inventory pending'}],
                    })
            elif url.path == '/api/resources/cleanup/cleanup/retry':
                mutations.append(url.path)
                assert route.request.method == 'POST'
                state['task'] = 'PENDING'
                route.fulfill(json={'queued': True})
            elif url.path == '/api/resources/servers/retired/scan':
                mutations.append(url.path)
                assert route.request.method == 'POST'
                route.fulfill(json={'tasks': [], 'findings': []})
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)
        page.goto(base + '/servers')
        page.wait_for_load_state('networkidle')
        header = page.locator('.ant-collapse-header').filter(has_text='部署资源核对')
        expect(header).to_contain_text('待清理 1 / 待核对 1 / 待退役 1')
        header.click()
        expect(page.get_by_text('需人工核对', exact=True)).to_be_visible()
        expect(page.get_by_text('nextpanel-chain-old', exact=True)).to_be_visible()
        expect(page.get_by_text('面板无对应节点，需确认归属；未自动停止', exact=True)).to_be_visible()
        expect(page.get_by_role('link', name='Retired entry').first).to_have_attribute('href', '/servers/retired')
        expect(page.get_by_role('button', name='只读核对', exact=True)).to_be_disabled()
        page.get_by_role('button', name=re.compile(r'^重\s*试$')).click()
        expect(page.get_by_text('等待重试', exact=True)).to_be_visible()
        assert mutations == ['/api/resources/cleanup/cleanup/retry']
        page.get_by_label('待核对服务器').click()
        page.locator('.ant-select-item-option').filter(has_text='Retired entry').click()
        page.get_by_role('button', name='只读核对', exact=True).click()
        expect(page.get_by_text('资源核对完成；不会自动停止归属不明的服务', exact=True)).to_be_visible()
        assert mutations[-1] == '/api/resources/servers/retired/scan'
        page.get_by_role('button', name='移出列表', exact=True).click()
        expect(page.locator('.ant-modal-confirm-title').filter(has_text='移出列表并保留清理任务？')).to_be_visible()
        expect(page.get_by_text('Final inventory unavailable', exact=False).last).to_be_visible()
        page.get_by_role('button', name='移出并继续清理', exact=True).click()
        expect(page.get_by_role('button', name='移出列表', exact=True)).to_have_count(0)
        assert mutations[-1] == '/api/servers/pending'
        expect(page.locator('.ant-modal-confirm-title')).to_be_hidden()
        page.keyboard.press('Escape')
        page.evaluate('window.scrollTo(0, 0)')
        page.screenshot(path=str(output / f'resource-lifecycle-{width}.png'), full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'viewport overflow'
        assert errors == [], errors
        state['fail_list'] = True
        page.reload()
        page.wait_for_load_state('networkidle')
        page.locator('.ant-collapse-header').filter(has_text='部署资源核对').click()
        expect(page.get_by_text('无法读取资源状态', exact=True)).to_be_visible(timeout=20000)
        assert errors == [], errors
        context.close()
        print(f'PASS lifecycle status, retained-host link, guarded retry, read-only scan, error state: {width}px')
    browser.close()
