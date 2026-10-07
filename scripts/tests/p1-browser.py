"""P1 UI regression against a local fixture-only production frontend."""
import json
import re
import sys
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

base = sys.argv[1].rstrip('/')
assert urlparse(base).hostname in ('localhost', '127.0.0.1')
server = {'id': 'srv', 'name': 'Fixture server', 'ip': '192.0.2.1', 'status': 'ONLINE',
          'region': 'test', 'provider': 'test', 'tags': [], 'nodeCount': 1}
node = {'id': 'node', 'serverId': 'srv', 'name': 'Fixture node', 'protocol': 'VLESS',
        'status': 'RUNNING', 'enabled': True, 'listenPort': 443, 'server': server,
        'statsPort': None, 'trafficUpBytes': 0, 'trafficDownBytes': 0}
seed = """
localStorage.setItem('auth-store', JSON.stringify({state:{user:{id:'owner',username:'owner',role:'ADMIN'},token:'fixture'},version:0}));
localStorage.setItem('access_token','fixture');
window.qaStreams = []; window.qaHoldNext = false;
const originalFetch = window.fetch;
window.fetch = (url, options) => {
  if (!/\\/api\\/nodes\\/(node\\/(deploy|delete)-stream|test-all)$/.test(String(url))) return originalFetch(url, options);
  const stream = {cancelled:false};
  const body = new ReadableStream({start(controller){stream.controller=controller},cancel(){stream.cancelled=true}});
  const response = new Response(body, {headers:{'Content-Type':'text/event-stream'}});
  window.qaStreams.push(stream);
  // Deliberately ignore fetch AbortSignal here to exercise delayed old responses.
  if (window.qaHoldNext) {
    window.qaHoldNext=false;
    return new Promise(resolve => {stream.release=()=>resolve(response)});
  }
  return Promise.resolve(response);
};
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    def fixture(width=1440):
        context = browser.new_context(viewport={'width': width, 'height': 1000})
        context.add_init_script(seed)
        page = context.new_page()
        state = {'errors': [], 'metrics': []}
        page.on('pageerror', lambda error: state['errors'].append(str(error)))

        def handle(route):
            url = urlparse(route.request.url)
            if url.hostname not in ('localhost', '127.0.0.1'):
                route.abort()
            elif not url.path.startswith('/api/'):
                route.continue_()
            elif url.path == '/api/nodes':
                route.fulfill(json=[node])
            elif url.path == '/api/servers':
                route.fulfill(json=[server])
            elif url.path == '/api/servers/srv':
                route.fulfill(json=server)
            elif url.path.startswith('/api/metrics/servers/'):
                query = parse_qs(url.query)
                state['metrics'].append(query)
                if query.get('range'):
                    route.fulfill(json=[])
                else:
                    route.fulfill(json=[{'id': 'metric', 'serverId': 'srv', 'timestamp': '2026-10-07T10:00:00Z',
                                         'cpu': 10, 'mem': 20, 'disk': 30, 'networkIn': 100, 'networkOut': 200}])
            elif url.path.startswith('/api/ip-check/'):
                route.fulfill(json=None)
            else:
                route.fulfill(json=[])
        page.route('**/*', handle)
        return context, page, state

    def open_deploy(page, count):
        page.get_by_role('button').filter(has=page.get_by_role('img', name='ellipsis', exact=True)).last.click()
        page.get_by_role('menuitem').filter(has=page.get_by_text('部署', exact=True)).click()
        page.wait_for_function('(n)=>window.qaStreams.length===n', arg=count)

    def emit(page, index, events, close=True):
        text = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events)
        page.evaluate("""({index,text,close})=>{
          const stream=window.qaStreams[index];
          if(text) stream.controller.enqueue(new TextEncoder().encode(text));
          if(close) stream.controller.close();
        }""", {'index': index, 'text': text, 'close': close})

    for width in (1440, 390):
        print(f'START deploy terminal flows: {width}px', flush=True)
        context, page, state = fixture(width)
        page.goto(base + '/nodes')
        page.wait_for_load_state('networkidle')
        open_deploy(page, 1)
        emit(page, 0, [{'log': 'fixture started'}])
        expect(page.get_by_text('连接中断，结果未知', exact=True)).to_be_visible()
        expect(page.get_by_text('部署中', exact=True)).to_have_count(0)
        page.get_by_role('button', name=re.compile(r'^关\s*闭$')).last.click()
        open_deploy(page, 2)
        emit(page, 1, [{'done': True, 'success': False}])
        expect(page.get_by_text('部署失败', exact=True)).to_be_visible()
        page.get_by_role('button', name=re.compile(r'^关\s*闭$')).last.click()
        open_deploy(page, 3)
        emit(page, 2, [{'done': True, 'success': True}], close=False)
        expect(page.get_by_text('部署成功', exact=True)).to_be_visible()
        assert page.evaluate('window.qaStreams[2].cancelled')
        assert state['errors'] == [], state['errors']
        context.close()
        print(f'PASS deploy EOF, explicit failure and terminal success: {width}px')

    context, page, state = fixture()
    page.goto(base + '/nodes')
    page.wait_for_load_state('networkidle')
    page.evaluate('window.qaHoldNext=true')
    open_deploy(page, 1)
    page.locator('.ant-drawer-close').click()
    open_deploy(page, 2)
    emit(page, 1, [{'done': True, 'success': True}])
    expect(page.get_by_text('部署成功', exact=True)).to_be_visible()
    emit(page, 0, [{'log': 'stale old operation'}, {'done': True, 'success': False}])
    page.evaluate('window.qaStreams[0].release()')
    page.wait_for_timeout(150)
    expect(page.get_by_text('部署成功', exact=True)).to_be_visible()
    expect(page.get_by_text('stale old operation', exact=True)).to_have_count(0)
    expect(page.get_by_text('部署失败', exact=True)).to_have_count(0)
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS late cancelled response cannot overwrite a newly completed operation')

    context, page, state = fixture()
    page.goto(base + '/nodes')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='批量测试', exact=True).click()
    page.wait_for_function('window.qaStreams.length===1')
    emit(page, 0, [])
    expect(page.get_by_text('批量测试连接中断', exact=True)).to_be_visible()
    expect(page.get_by_role('button', name='批量测试', exact=True)).to_be_enabled()
    page.get_by_role('button', name='批量测试', exact=True).click()
    page.get_by_role('button', name='停止接收测试结果', exact=True).click()
    expect(page.get_by_text('已停止接收测试结果，远端测试可能仍在执行', exact=True)).to_be_visible()
    assert page.evaluate('window.qaStreams[1].cancelled')
    page.get_by_role('button', name='批量测试', exact=True).click()
    page.wait_for_function('window.qaStreams.length===3')
    emit(page, 2, [{'type': 'done', 'total': 1}])
    expect(page.get_by_text('批量测试完成，共 1 个节点', exact=True)).to_be_visible()
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS batch EOF, cancellation and successful restart')

    context, page, state = fixture()
    page.goto(base + '/nodes')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='批量测试', exact=True).click()
    page.wait_for_function('window.qaStreams.length===1')
    page.get_by_role('menuitem').filter(has=page.get_by_text('服务器', exact=True)).click()
    page.wait_for_url('**/servers')
    page.wait_for_function('window.qaStreams[0].cancelled')
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS navigation unmount closes the active stream')

    context, page, state = fixture()
    page.goto(base + '/servers/srv')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_label('指标时间范围')).to_be_visible()
    assert state['metrics'] == [{'limit': ['60']}], state['metrics']
    page.get_by_label('指标时间范围').click()
    page.get_by_title('最近 7 天', exact=True).click()
    expect(page.get_by_text('暂无监控数据', exact=True)).to_be_visible()
    assert state['metrics'][-1] == {'limit': ['120'], 'range': ['7d']}, state['metrics']
    expect(page.get_by_text('按时间桶展示已收到样本的平均值；缺失时段不补零。', exact=True)).to_be_visible()
    assert state['errors'] == [], state['errors']
    context.close()
    print('PASS metric range requests are bounded and empty snapshots clear the chart')
    browser.close()
