'use strict';
'require view';
'require form';
'require uci';
'require rpc';
'require ui';
'require poll';

// RPC declarations
var callExec = rpc.declare({
  object: 'file',
  method: 'exec',
  params: ['command', 'params'],
  expect: { stdout: '' }
});

var callReadFile = rpc.declare({
  object: 'file',
  method: 'read',
  params: ['path'],
  expect: { data: '' }
});

return view.extend({

  load: function () {
    return Promise.all([
      uci.load('nextpanel'),
      callReadFile('/var/log/nextpanel-sync.log').catch(function () { return { data: '' }; }),
    ]);
  },

  render: function (data) {
    var logContent = (data[1] && data[1].data) ? data[1].data : '';
    var logLines = logContent.split('\n').filter(function (l) { return l.trim().length > 0; });
    var recentLog = logLines.slice(-30).join('\n');

    var lastSync   = uci.get('nextpanel', 'config', 'last_sync')   || '从未同步';
    var lastStatus = uci.get('nextpanel', 'config', 'last_status') || '';
    var lastError  = uci.get('nextpanel', 'config', 'last_error')  || '';

    var m, s, o;

    m = new form.Map('nextpanel', 'NextPanel 同步',
      '自动将 NextPanel 面板的节点配置同步到路由器 HomeProxy，无需手动维护。');

    // ── 设置 ──────────────────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', '设置');
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.Flag, 'enabled', '启用自动同步',
      '开启后按设定间隔自动拉取最新配置；关闭后仍可手动同步。');
    o.rmempty = false;

    o = s.option(form.Value, 'subscription_url', '订阅链接',
      '从 NextPanel 面板「订阅」页面复制 V2Ray 订阅链接（不要选 HomeProxy 专用链接）。');
    o.placeholder = 'https://your-panel.example.com/api/subscriptions/link/TOKEN';
    o.rmempty = false;
    o.datatype = 'string';

    o = s.option(form.ListValue, 'interval', '自动同步间隔');
    o.value('0',     '关闭');
    o.value('3600',  '每 1 小时');
    o.value('21600', '每 6 小时');
    o.value('86400', '每 24 小时（推荐）');
    o.default = '86400';
    o.rmempty = false;

    // ── 同步状态 ──────────────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', '同步状态');
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_status', '上次同步');
    o.rawhtml = true;
    o.cfgvalue = function () {
      var statusColor = lastStatus === 'success' ? '#52c41a'
                      : lastStatus === 'error'   ? '#ff4d4f'
                      : '#8c8c8c';
      var statusText  = lastStatus === 'success' ? '✓ 成功'
                      : lastStatus === 'error'   ? '✗ 失败'
                      : '尚未同步';
      var html = '<span style="color:' + statusColor + ';font-weight:500">' + statusText + '</span>';
      html += '&nbsp;&nbsp;<span style="color:#8c8c8c;font-size:12px">' + lastSync + '</span>';
      if (lastStatus === 'error' && lastError) {
        html += '<br><span style="color:#ff4d4f;font-size:12px">' + lastError + '</span>';
      }
      return html;
    };

    o = s.option(form.DummyValue, '_actions', '操作');
    o.rawhtml = true;
    o.cfgvalue = function () {
      return '<button class="btn cbi-button cbi-button-action" id="nextpanel-sync-btn">' +
             '立即同步</button>' +
             '<span id="nextpanel-sync-status" style="margin-left:12px;font-size:13px"></span>';
    };

    // ── 同步日志 ──────────────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', '同步日志');
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_log', '最近日志');
    o.rawhtml = true;
    o.cfgvalue = function () {
      var escaped = recentLog
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return '<pre style="background:#1a1a1a;color:#d4d4d4;padding:12px;border-radius:6px;' +
             'font-size:12px;max-height:240px;overflow-y:auto;white-space:pre-wrap;word-break:break-all">' +
             (escaped || '暂无日志。') + '</pre>';
    };

    // ── HomeProxy 配置指引 ────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', 'HomeProxy 配置指引');
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_guide', '');
    o.rawhtml = true;
    o.cfgvalue = function () {
      return [
        '<div style="font-size:13px;line-height:1.8;color:rgba(0,0,0,0.75)">',
        '<p><strong>首次同步后，在 HomeProxy 中完成一次性配置：</strong></p>',
        '<ol style="padding-left:20px;margin:0">',
        '<li>进入 <b>服务 → HomeProxy → 节点设置</b></li>',
        '<li>确认节点已自动导入（同步时由 NextPanel 写入）</li>',
        '<li>在「主节点」下拉框中选择要使用的节点</li>',
        '<li>进入<b>代理设置</b>，将「路由模式」设为<b>绕过中国大陆</b>或<b>全局代理</b></li>',
        '<li>将「代理模式」设为 <b>redirect + tproxy</b> 或 <b>TUN</b></li>',
        '<li>保存并应用，然后点击右上角<b>启用</b>开关</li>',
        '</ol>',
        '<p style="margin-top:8px;color:#8c8c8c">',
        '以上步骤只需配置一次。之后每次同步，NextPanel 会自动更新节点列表并重载 HomeProxy。',
        '</p>',
        '<p style="margin-top:4px"><strong>内置分流规则：</strong>',
        '广告屏蔽 · AI 服务代理 · 流媒体代理 · 中国大陆直连 · 局域网直连 · 其余流量走代理',
        '</p>',
        '</div>',
      ].join('');
    };

    return m.render().then(function (node) {
      var btn = node.querySelector('#nextpanel-sync-btn');
      var statusEl = node.querySelector('#nextpanel-sync-status');
      if (btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          btn.textContent = '同步中…';
          if (statusEl) statusEl.textContent = '';

          callExec('/etc/init.d/nextpanel-sync', ['force_sync'])
            .then(function () {
              if (statusEl) {
                statusEl.style.color = '#52c41a';
                statusEl.textContent = '✓ 同步完成，刷新页面查看最新状态';
              }
            })
            .catch(function (err) {
              if (statusEl) {
                statusEl.style.color = '#ff4d4f';
                statusEl.textContent = '✗ 同步失败：' + (err.message || String(err));
              }
            })
            .finally(function () {
              btn.disabled = false;
              btn.textContent = '立即同步';
            });
        });
      }
      return node;
    });
  },

  handleSave: function (ev) {
    return this.super('handleSave', [ev]).then(function () {
      return callExec('/etc/init.d/nextpanel-sync', ['restart']).catch(function () {});
    });
  },

});
