"""Synthetic inventory UI checks. No production API or outbound network access."""
import copy
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
output = Path('out/hardware-info-20261111')
output.mkdir(parents=True, exist_ok=True)


def stamp(hours=0):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


values = {'cpuModel': 'AMD EPYC Synthetic CPU', 'cpuLogicalCores': 2, 'architecture': 'amd64',
          'memoryTotalBytes': 4 * 1024**3, 'rootTotalBytes': 80 * 1024**3, 'rootFsType': 'ext4',
          'osName': 'debian', 'osVersion': '12', 'kernelVersion': '6.1.0',
          'virtualizationSystem': 'kvm', 'virtualizationRole': 'guest'}
server = {'id': 'hardware', 'name': 'Hardware fixture', 'ip': '192.0.2.1', 'status': 'ONLINE',
          'region': 'fixture', 'provider': 'fixture', 'tags': [], 'autoTags': [],
          'sshPort': 22, 'sshUser': 'root', 'sshAuthType': 'KEY', 'credentialsDestroyed': True,
          'agentVersion': '1.9.0', 'lastSeenAt': stamp(), 'createdAt': stamp(24),
          'cpuUsage': 20, 'memUsage': 30, 'diskUsage': 40, 'networkIn': 1024, 'networkOut': 2048,
          'systemInfo': {'schemaVersion': 1, 'agentVersion': '1.9.0', 'collectedAt': stamp(),
                         'receivedAt': stamp(), 'missingFields': [],
                         'fields': {key: {'value': value, 'collectedAt': stamp()} for key, value in values.items()}}}
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width in (1440, 390):
        for theme in ('light', 'dark'):
            context = browser.new_context(viewport={'width': width, 'height': 1100})
            context.add_init_script(seed + f"localStorage.setItem('np-theme-mode', '{theme}');")
            page = context.new_page()
            errors, mutations = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            state = {'server': copy.deepcopy(server)}

            def route_request(route):
                url = urlparse(route.request.url)
                if url.hostname not in ('localhost', '127.0.0.1'):
                    route.abort()
                elif not url.path.startswith('/api/'):
                    route.continue_()
                else:
                    if route.request.method != 'GET':
                        mutations.append(url.path)
                    if url.path == '/api/servers/hardware':
                        route.fulfill(json=state['server'])
                    elif url.path.startswith('/api/ip-check/'):
                        route.fulfill(json=None)
                    else:
                        route.fulfill(json=[])

            page.route('**/*', route_request)

            def load():
                page.goto(base + '/servers/hardware')
                page.wait_for_load_state('networkidle')
                return page.locator('.ant-card').filter(has=page.locator('.ant-card-head-title', has_text='硬件与系统'))

            card = load()
            expect(card.get_by_text('采集正常', exact=True)).to_be_visible()
            expect(card.get_by_text('4.00 GiB', exact=True)).to_be_visible()
            expect(card.get_by_text('80.00 GiB', exact=True)).to_be_visible()
            expect(card.get_by_text('vCPU 数', exact=True)).to_be_visible()
            expect(page.get_by_text('根分区使用率', exact=True)).to_be_visible()
            expect(page.get_by_role('button', name='恢复凭证', exact=True)).to_be_visible()
            card.screenshot(path=str(output / f'hardware-{width}-{theme}.png'))
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')

            state['server']['systemInfo']['missingFields'] = ['cpuModel']
            state['server']['systemInfo']['fields']['cpuModel']['collectedAt'] = stamp(6)
            card = load()
            expect(card.get_by_text('部分信息未获取', exact=True)).to_be_visible()
            expect(card.get_by_text('本次未获取；上次成功', exact=False)).to_be_visible()
            expect(card.get_by_text('AMD EPYC Synthetic CPU', exact=True)).to_be_visible()

            state['server']['systemInfo']['collectedAt'] = stamp(3)
            card = load()
            expect(card.get_by_text('配置信息已过期', exact=True)).to_be_visible()
            state['server']['status'] = 'OFFLINE'
            card = load()
            expect(card.get_by_text('显示最后一次采集结果，不代表当前配置已确认', exact=True)).to_be_visible()

            state['server'] = copy.deepcopy(server)
            state['server']['systemInfo'] = None
            card = load()
            expect(card.get_by_text('等待首次采集', exact=True)).to_be_visible()
            state['server']['agentVersion'] = '1.8.0'
            card = load()
            expect(card.get_by_text('当前 Agent 尚不支持硬件信息', exact=True)).to_be_visible()
            expect(card.get_by_role('link', name='前往服务器列表管理 Agent')).to_have_attribute('href', '/servers')

            state['server'] = copy.deepcopy(server)
            state['server']['systemInfo']['fields'] = {}
            state['server']['systemInfo']['missingFields'] = list(values)
            card = load()
            expect(card.get_by_text('部分信息未获取', exact=True)).to_be_visible()
            expect(card.get_by_text('未知', exact=True)).to_have_count(2)
            expect(card.get_by_text('0.00 GiB', exact=True)).to_have_count(0)

            state['server']['systemInfo'] = {'schemaVersion': 2}
            card = load()
            expect(card.get_by_text('当前面板不支持此硬件信息格式，请升级面板', exact=True)).to_be_visible()

            state['server'] = copy.deepcopy(server)
            state['server']['systemInfo']['fields']['cpuModel']['value'] = '<script>alert(1)</script>' + 'CPU' * 75
            state['server']['systemInfo']['fields']['virtualizationSystem']['value'] = 'docker'
            card = load()
            expect(card.get_by_text('逻辑 CPU 数', exact=True)).to_be_visible()
            expect(card.get_by_text('容器内不代表配额', exact=False)).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
            assert errors == [], errors
            assert mutations == [], mutations
            context.close()
            print(f'PASS hardware inventory normal, partial, stale, offline, waiting, unsupported, container, escaped long text: {width}px {theme}')
    browser.close()
