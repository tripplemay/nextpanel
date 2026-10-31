"""Server-side usage UI fixtures. All API data is synthetic; external requests are blocked."""
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
output = Path('out/ci')
output.mkdir(parents=True, exist_ok=True)
now = datetime.now(timezone.utc)
stamp = now.isoformat()
old = (now - timedelta(minutes=5)).isoformat()
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, mode in [(1440, 'light'), (1440, 'dark'), (390, 'light'), (390, 'dark')]:
        now = datetime.now(timezone.utc)
        stamp = now.isoformat()
        old = (now - timedelta(minutes=5)).isoformat()
        context = browser.new_context(viewport={'width': width, 'height': 1050})
        context.add_init_script(seed + f"localStorage.setItem('np-theme-mode','{mode}');")
        page = context.new_page()
        errors, mutations = [], []
        rows = []
        for i, status in enumerate(['ACTIVE', 'ACTIVE', 'STALE', 'PENDING', 'IDLE', 'PAUSED']):
            rows.append({'id': f'identity-{i}', 'subscriptionId': 's1', 'subscriptionName': 'AI 工作空间',
                         'subjectId': f'user-{i}', 'subjectName': ['Alex Chen', 'Taylor Lin', 'Morgan', '新分享接收者', 'Jordan', '已暂停观测'][i],
                         'grantKind': 'OWNER' if i == 0 else 'SHARE', 'nodeId': 'n1', 'nodeName': '香港 · CDN 入口',
                         'candidateIp': '2606:4700:4700::1111' if i == 1 else f'104.16.0.{i+1}',
                         'profile': ['REGION:ap-guangzhou', 'REGION:ap-chengdu', 'DNS', 'GENERIC', 'TELECOM', 'GENERIC'][i],
                         'label': '香港 [CF fixture] 通用候选 1', 'status': status,
                         'sampledAt': old if status == 'STALE' else stamp,
                         'lastActiveAt': stamp if status in ('ACTIVE', 'STALE') else None,
                         'installedAt': None if status == 'PENDING' else stamp,
                         'upRate': 20480 if status == 'ACTIVE' else None,
                         'downRate': 2457600 if status == 'ACTIVE' else None,
                         'evidence': 'SERVER_CREDENTIAL', 'actualEdgeIp': None})
        state = {'failed': False, 'enabled': True, 'rows': rows, 'regional_rollout': False}
        payload = {'enabled': True, 'asOf': stamp, 'freshnessSeconds': 90, 'activeWindowSeconds': 60, 'limited': False,
                   'subscriptions': [{'id': 's1', 'name': 'AI 工作空间', 'enabled': True, 'externalCount': 2, 'automatic': True, 'protectedCount': 2}],
                   'nodes': [{'id': 'n1', 'name': '香港 · CDN 入口', 'eligible': True, 'preparedAt': stamp, 'syncedAt': stamp, 'sampledAt': stamp, 'legacyActiveAt': stamp, 'error': None},
                             {'id': 'n2', 'name': '洛杉矶 · CDN 入口', 'eligible': True, 'preparedAt': None, 'syncedAt': None, 'sampledAt': None, 'legacyActiveAt': None, 'error': None},
                             {'id': 'n3', 'name': '外部链路', 'eligible': False, 'preparedAt': None, 'syncedAt': None, 'sampledAt': None, 'legacyActiveAt': None, 'error': None}],
                   'summary': {'activeSubjects': 2, 'activeCandidates': 2, 'preparedNodes': 1, 'freshNodes': 1, 'legacyActiveNodes': 1}}
        page.on('pageerror', lambda e: errors.append(str(e)))
        for node in payload['nodes']:
            node['observing'] = node['eligible']
            node['fresh'] = bool(node['sampledAt'])
            node['serverId'] = 'fixture-server'
            node['agentVersion'] = '1.8.0'
            node['agentSeenAt'] = stamp

        def handle(route):
            path = urlparse(route.request.url)
            if path.hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not path.path.startswith('/api/'):
                route.continue_()
            elif path.path == '/api/usage':
                route.fulfill(status=503 if state['failed'] else 200,
                              json={'message': 'fixture unavailable'} if state['failed'] else {**payload, 'rows': state['rows'], 'enabled': state['enabled']})
            elif path.path.endswith('/history'):
                route.fulfill(json=[{'timestamp': stamp, 'upBytes': '1048576', 'downBytes': '8388608'}])
            elif path.path.startswith('/api/subscriptions/cf-access/optimization/'):
                route.fulfill(json={'paused': False, 'enabled': True, 'registryError': False, 'rangeError': False, 'rangeUpdatedAt': stamp,
                                    'regions': [{'key': 'ap-guangzhou', 'label': '广州'}, {'key': 'ap-chengdu', 'label': '成都'}], 'missingRegions': ['ap-chengdu'],
                                    'budget': ({'lowBudget': False, 'intervalMinutes': 15, 'monthlyLimit': 25000, 'used': 24, 'remaining': 24976, 'estimatedMonthlyBatchesPerNode': 5760, 'constrained': False, 'error': False}
                                               if state['regional_rollout'] else {'lowBudget': True, 'intervalMinutes': 5, 'monthlyLimit': 200, 'used': 24, 'remaining': 176, 'estimatedMonthlyBatchesPerNode': 360, 'constrained': True, 'error': False}),
                                    'profiles': [{'probeId': 'guangzhou-cloud', 'regionKey': 'ap-guangzhou', 'classification': 'REGIONAL', 'networkType': 'CLOUD', 'region': '广州', 'checkedAt': stamp, 'stale': False,
                                                  'error': None, 'revision': 3, 'candidates': [{'ip': '104.16.0.1', 'latency': 180, 'checkedAt': int(now.timestamp() * 1000), 'failed': 0}]},
                                                 {'probeId': 'chengdu-cloud', 'regionKey': 'ap-chengdu', 'classification': 'REGIONAL', 'networkType': 'CLOUD', 'region': '成都', 'checkedAt': None,
                                                  'stale': True, 'error': 'PROBE_UNAVAILABLE', 'revision': 0, 'candidates': []}]})
            elif route.request.method == 'POST':
                mutations.append((path.path, route.request.post_data_json))
                if path.path == '/api/subscriptions/s1/usage':
                    payload['subscriptions'][0]['enabled'] = route.request.post_data_json['enabled']
                    state['rows'] = [{**r, 'status': 'PAUSED'} for r in rows]
                route.fulfill(json={'ok': True})
            else:
                route.fulfill(json=[])

        page.route('**/*', handle)
        page.goto(base + '/usage')
        page.wait_for_load_state('networkidle')
        expect(page.get_by_text('无需客户端安装', exact=True)).to_be_visible()
        expect(page.get_by_text('Alex Chen', exact=True)).to_be_visible()
        expect(page.get_by_text('数据待更新', exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'horizontal overflow'
        page.screenshot(path=str(output / f'usage-{width}-{mode}.png'))
        if width < 768:
            page.get_by_role('button', name='查看 已暂停观测 在 香港 · CDN 入口 的证据').scroll_into_view_if_needed()
            expect(page.get_by_role('button', name='查看 已暂停观测 在 香港 · CDN 入口 的证据')).to_be_in_viewport()
            page.screenshot(path=str(output / f'usage-cards-{width}-{mode}.png'))
        page.get_by_label('搜索使用记录').fill('no-such-identity')
        expect(page.get_by_text('没有符合筛选条件的记录')).to_be_visible()
        page.get_by_label('搜索使用记录').fill('Alex')
        page.get_by_role('button', name='查看 Alex Chen 在 香港 · CDN 入口 的证据').click()
        expect(page.get_by_role('dialog')).to_be_visible()
        expect(page.get_by_text('未独立验证', exact=True)).to_be_visible()
        page.get_by_role('tab', name='流量趋势').click()
        expect(page.get_by_role('img', name='近 7 天已观测流量，详细数值见下方表格')).to_be_visible()
        page.screenshot(path=str(output / f'usage-detail-{width}-{mode}.png'))
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).to_be_hidden()
        page.get_by_label('搜索使用记录').fill('')
        page.get_by_role('tab', name='优选状态', exact=True).click()
        expect(page.get_by_text('后台自动维护已开启', exact=True)).to_be_visible()
        expect(page.get_by_text('自动优选已开启', exact=True)).to_be_visible()
        expect(page.get_by_text('已用 24 / 200 批 · 剩余 176 批（不是云账单硬限额）', exact=True)).to_be_visible()
        expect(page.get_by_text('广州 · 有新鲜候选', exact=True)).to_be_visible()
        expect(page.get_by_text('成都 · 缺少新鲜候选', exact=True)).to_be_visible()
        expect(page.get_by_text('当前批次额度不足以持续覆盖所有地区', exact=True)).to_be_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'CF status overflow'
        assert not mutations, 'viewing optimization must not trigger probes or server writes'
        page.screenshot(path=str(output / f'usage-cf-{width}-{mode}.png'))
        state['regional_rollout'] = True
        page.reload()
        page.wait_for_load_state('networkidle')
        page.get_by_role('tab', name='优选状态', exact=True).click()
        expect(page.get_by_text('每 15 分钟（额度、失败退避与任务队列可能延后）', exact=True)).to_be_visible()
        expect(page.get_by_text('已用 24 / 25000 批 · 剩余 24976 批（不是云账单硬限额）', exact=True)).to_be_visible()
        expect(page.get_by_text('当前批次额度不足以持续覆盖所有地区', exact=True)).not_to_be_visible()
        assert not mutations, 'regional status refresh must be read-only'
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), 'regional status overflow'
        page.get_by_text('广州 · 云测点', exact=True).scroll_into_view_if_needed()
        expect(page.get_by_text('广州 · 云测点', exact=True)).to_be_in_viewport()
        page.screenshot(path=str(output / f'usage-cf-regional-{width}-{mode}.png'))
        page.get_by_text('成都 · 云测点', exact=True).scroll_into_view_if_needed()
        expect(page.get_by_text('成都 · 云测点', exact=True)).to_be_in_viewport()
        page.screenshot(path=str(output / f'usage-cf-regional-missing-{width}-{mode}.png'))
        page.get_by_role('tab', name='接入与覆盖').click()
        page.get_by_role('button', name='准备节点', exact=True).click()
        expect(page.get_by_text(re.compile('首次准备可能需要重启此节点'))).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^取\s*消$')).click()
        assert not mutations, 'opening/canceling setup must never mutate a server'
        page.get_by_role('button', name='同步凭据', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='同步凭据').click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        assert mutations == [('/api/usage/nodes/n1/prepare', {'allowRestart': False})]
        page.screenshot(path=str(output / f'usage-coverage-{width}-{mode}.png'))
        page.get_by_role('switch', name='AI 工作空间 服务端观测').click()
        page.get_by_role('dialog').get_by_role('button', name='暂停观测').click()
        expect(page.get_by_role('dialog')).to_be_hidden()
        expect(page.get_by_role('switch', name='AI 工作空间 服务端观测')).not_to_be_checked()
        state['failed'] = True
        page.get_by_role('button', name='刷新状态').click()
        expect(page.get_by_text('状态刷新失败', exact=True)).to_be_visible(timeout=10000)
        state['failed'] = False
        state['enabled'] = False
        page.get_by_role('button', name='刷新状态').click()
        expect(page.get_by_text('服务端观测尚未启用', exact=True)).to_be_visible()
        assert page.locator('[class*="metricValue"]').all_text_contents() == ['—'] * 4, 'paused global metrics must not imply measured zeros'
        assert not errors, errors
        print(f'Usage UI PASS: {width}px {mode}; evidence, filters, confirmation, pause, error; mutations={len(mutations)}', flush=True)
        context.close()
    browser.close()
