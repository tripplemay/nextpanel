"""Opt-in UI smoke against an isolated local Next build; every API call is mocked.

Usage: python3 scripts/tests/security-closeout-browser.py http://127.0.0.1:3409
Requires Python Playwright and its Chromium browser. Never contacts the production API.
"""
import json
import re
import sys
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('127.0.0.1', 'localhost'), 'Only a local fixture server is allowed'
user = {'id': 'owner', 'username': 'owner', 'role': 'ADMIN'}
node = {'id': 'ext', 'userId': 'owner', 'name': 'Encrypted fixture', 'protocol': 'HTTP', 'address': 'proxy.test', 'port': 80}
secrets = {'uuid': None, 'username': 'proxy-user', 'password': 'proxy-secret', 'rawUri': 'http://proxy-user:proxy-secret@proxy.test', 'xhttpExtra': None, 'shortId': None}
seed = """if (!localStorage.getItem('qa-initialized')) {
  localStorage.setItem('auth-store', JSON.stringify({state:{user:%s,token:'old-token'},version:0}));
  localStorage.setItem('access_token','old-token'); localStorage.setItem('qa-initialized','1');
}""" % json.dumps(user)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    def fixture(width=1440, hold_config=False, hold_revoke=False):
        context = browser.new_context(viewport={'width': width, 'height': 900})
        context.add_init_script(seed)
        page = context.new_page()
        state = {'held': [], 'revocations': [], 'errors': [], 'calls': [], 'hold': hold_config}
        page.on('pageerror', lambda error: state['errors'].append(str(error)))

        def handle(route):
            path = urlparse(route.request.url).path
            state['calls'].append(path)
            body = route.request.post_data_json if route.request.post_data else {}
            if path == '/api/external-nodes':
                route.fulfill(json=[node])
            elif path.endswith('/credentials'):
                if body.get('currentPassword') != 'current-password':
                    route.fulfill(status=400, json={'message': '当前密码不正确'})
                else:
                    route.fulfill(headers={'Cache-Control': 'no-store'}, json=secrets)
            elif path == '/api/auth/revoke-other-sessions':
                if hold_revoke:
                    state['revocations'].append(route)
                else:
                    route.fulfill(json={'accessToken': 'replacement-token', 'user': user})
            elif path == '/api/auth/change-password':
                assert body == {'currentPassword': 'current-password', 'newPassword': 'new-password'}
                route.fulfill(json={'message': 'changed'})
            elif path.endswith('/configured'):
                if state['hold']:
                    state['held'].append(route)
                else:
                    route.fulfill(json={'configured': False})
            else:
                route.fulfill(json=[])
        page.route('**/api/**', handle)
        return context, page, state

    for width in (1440, 390):
        print(f'START credential reveal flow: {width}px', flush=True)
        context, page, state = fixture(width)
        page.goto(base + '/external-nodes')
        page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button', name='查看节点凭据')).to_be_visible()
        assert not any(path.endswith('/credentials') for path in state['calls'])
        page.get_by_role('button', name='查看节点凭据').click()
        dialog = page.get_by_role('dialog')
        expect(dialog).to_be_visible()
        page.get_by_label('确认当前密码').fill('wrong')
        page.get_by_role('button', name='验证并查看').click()
        expect(page.get_by_text('当前密码不正确', exact=True)).to_be_visible()
        expect(page.get_by_label('确认当前密码')).to_have_value('')
        assert '/login' not in page.url
        page.get_by_label('确认当前密码').fill('current-password')
        page.get_by_role('button', name='验证并查看').click()
        expect(page.get_by_label('password', exact=True)).to_have_value('proxy-secret')
        box = dialog.bounding_box()
        assert box['x'] >= 0 and box['x'] + box['width'] <= width + 1
        stored = page.evaluate('JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage})')
        assert 'proxy-secret' not in stored and 'current-password' not in stored
        dialog.locator('.ant-modal-footer button').last.click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        page.get_by_role('button', name='查看节点凭据').click()
        expect(page.get_by_label('确认当前密码')).to_have_value('')
        expect(page.get_by_label('password', exact=True)).to_have_count(0)
        page.get_by_role('button', name='Close', exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        if width == 1440:
            print('START credential expiry clock check', flush=True)
            page.clock.install()
            page.get_by_role('button', name='查看节点凭据').click()
            page.get_by_label('确认当前密码').fill('current-password')
            page.get_by_role('button', name='验证并查看').click()
            expect(page.get_by_label('password', exact=True)).to_have_value('proxy-secret')
            page.clock.fast_forward(61_000)
            expect(page.get_by_role('dialog')).to_have_count(0)
        assert state['errors'] == [], state['errors']
        context.close()
        print(f'PASS credential reveal, reauth failure, close/reset and no persisted secrets: {width}px')

    context, page, state = fixture(hold_config=True)
    page.goto(base + '/settings/account')
    page.get_by_role('button', name='退出其他设备').click()
    dialog = page.get_by_role('dialog')
    page.get_by_label('确认当前密码').fill('current-password')
    dialog.get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    page.wait_for_function("localStorage.getItem('access_token') === 'replacement-token'")
    assert state['held'], 'Expected the old-token configured request to remain in flight'
    state['hold'] = False
    for route in state['held']:
        assert route.request.headers.get('authorization') == 'Bearer old-token'
        route.fulfill(status=401, json={'message': 'old session revoked'})
    page.wait_for_load_state('networkidle')
    assert '/settings/account' in page.url
    assert page.evaluate("localStorage.getItem('access_token')") == 'replacement-token'
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS replacement session survives delayed 401 from an old in-flight request')

    context, page, state = fixture(hold_config=True, hold_revoke=True)
    page.goto(base + '/settings/account')
    page.get_by_role('button', name='退出其他设备').click()
    page.get_by_label('确认当前密码').fill('current-password')
    with page.expect_request('**/api/auth/revoke-other-sessions'):
        page.get_by_role('dialog').get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    assert state['held'] and state['revocations']
    state['hold'] = False
    state['held'][0].fulfill(status=401, json={'message': 'old session revoked'})
    page.wait_for_timeout(300)
    assert '/settings/account' in page.url, 'In-flight revocation must not prematurely log out the current device'
    state['revocations'][0].fulfill(json={'accessToken': 'replacement-token', 'user': user})
    page.wait_for_function("localStorage.getItem('access_token') === 'replacement-token'")
    page.wait_for_load_state('networkidle')
    assert '/settings/account' in page.url
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS current device survives 401 arriving before replacement JWT response')

    context, page, state = fixture(hold_config=True, hold_revoke=True)
    page.goto(base + '/settings/account')
    page.get_by_role('button', name='退出其他设备').click()
    page.get_by_label('确认当前密码').fill('current-password')
    with page.expect_request('**/api/auth/revoke-other-sessions'):
        page.get_by_role('dialog').get_by_role('button', name=re.compile(r'^确\s*定$')).click()
    state['hold'] = False
    state['held'][0].fulfill(status=401, json={'message': 'old session revoked'})
    state['revocations'][0].fulfill(status=500, json={'message': 'fixture failure'})
    page.wait_for_url('**/login')
    assert page.evaluate("localStorage.getItem('access_token')") is None
    context.close()
    print('PASS failed rotation releases the 401 waiter and clears the invalid old session')

    context, page, state = fixture()
    page.goto(base + '/settings/account')
    page.wait_for_load_state('networkidle')
    page.locator('#currentPassword').fill('current-password')
    page.locator('#newPassword').fill('new-password')
    page.locator('#confirmPassword').fill('new-password')
    page.get_by_role('button', name='修改密码', exact=True).click()
    page.wait_for_url('**/login')
    assert page.evaluate("localStorage.getItem('access_token')") is None
    assert json.loads(page.evaluate("localStorage.getItem('auth-store')"))['state']['token'] is None
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS password change clears local session and redirects to login')
    browser.close()
