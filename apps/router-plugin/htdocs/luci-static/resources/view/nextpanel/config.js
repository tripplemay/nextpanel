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
    // Show last 30 lines
    var logLines = logContent.split('\n').filter(function (l) { return l.trim().length > 0; });
    var recentLog = logLines.slice(-30).join('\n');

    var lastSync   = uci.get('nextpanel', 'config', 'last_sync')   || '—';
    var lastStatus = uci.get('nextpanel', 'config', 'last_status') || '—';
    var lastError  = uci.get('nextpanel', 'config', 'last_error')  || '';

    var m, s, o;

    m = new form.Map('nextpanel', _('NextPanel Sync'),
      _('Automatically syncs proxy configuration from your NextPanel panel to HomeProxy.'));

    // ── Settings section ──────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', _('Settings'));
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.Flag, 'enabled', _('Enable'),
      _('When enabled, the plugin will sync at the configured interval. Manual sync is always available regardless of this setting.'));
    o.rmempty = false;

    o = s.option(form.Value, 'subscription_url', _('Subscription URL'),
      _('Copy the HomeProxy URL from your NextPanel panel (Subscriptions → HomeProxy tab).'));
    o.placeholder = 'https://your-panel.example.com/api/subscriptions/link/TOKEN/homeproxy';
    o.rmempty = false;
    o.datatype = 'string';

    o = s.option(form.ListValue, 'interval', _('Auto Refresh Interval'));
    o.value('0',     _('Disabled'));
    o.value('3600',  _('Every 1 hour'));
    o.value('21600', _('Every 6 hours'));
    o.value('86400', _('Every 24 hours (recommended)'));
    o.default = '86400';
    o.rmempty = false;

    // ── Status section ────────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', _('Sync Status'));
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_status', _('Last sync'));
    o.rawhtml = true;
    o.cfgvalue = function () {
      var statusColor = lastStatus === 'success' ? '#52c41a'
                      : lastStatus === 'error'   ? '#ff4d4f'
                      : '#8c8c8c';
      var statusText  = lastStatus === 'success' ? '✓ ' + _('Success')
                      : lastStatus === 'error'   ? '✗ ' + _('Failed')
                      : _('Never synced');
      var html = '<span style="color:' + statusColor + ';font-weight:500">' + statusText + '</span>';
      html += '&nbsp;&nbsp;<span style="color:#8c8c8c;font-size:12px">' + lastSync + '</span>';
      if (lastStatus === 'error' && lastError) {
        html += '<br><span style="color:#ff4d4f;font-size:12px">' + lastError + '</span>';
      }
      return html;
    };

    // ── Sync Now button ───────────────────────────────────────────────────────
    o = s.option(form.DummyValue, '_actions', _('Actions'));
    o.rawhtml = true;
    o.cfgvalue = function () {
      return '<button class="btn cbi-button cbi-button-action" id="nextpanel-sync-btn">' +
             _('Sync Now') + '</button>' +
             '<span id="nextpanel-sync-status" style="margin-left:12px;font-size:13px"></span>';
    };

    // ── Log section ───────────────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', _('Sync Log'));
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_log', _('Recent log'));
    o.rawhtml = true;
    o.cfgvalue = function () {
      var escaped = recentLog
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return '<pre style="background:#1a1a1a;color:#d4d4d4;padding:12px;border-radius:6px;' +
             'font-size:12px;max-height:240px;overflow-y:auto;white-space:pre-wrap;word-break:break-all">' +
             (escaped || _('No log entries yet.')) + '</pre>';
    };

    // ── HomeProxy setup guide ─────────────────────────────────────────────────
    s = m.section(form.TypedSection, 'nextpanel', _('HomeProxy Setup Guide'));
    s.anonymous = true;
    s.addremove = false;

    o = s.option(form.DummyValue, '_guide', '');
    o.rawhtml = true;
    o.cfgvalue = function () {
      return [
        '<div style="font-size:13px;line-height:1.8;color:rgba(0,0,0,0.75)">',
        '<p><strong>' + _('After saving settings and running a sync, complete the one-time HomeProxy setup:') + '</strong></p>',
        '<ol style="padding-left:20px;margin:0">',
        '<li>' + _('Go to <b>Services → HomeProxy</b>') + '</li>',
        '<li>' + _('Under <b>Node Settings</b>, select the config file: <code>/etc/homeproxy/singbox.json</code>') + '</li>',
        '<li>' + _('Under <b>Proxy Settings</b>, set Mode to <b>Transparent Proxy</b>') + '</li>',
        '<li>' + _('Set the LAN interface (usually <code>br-lan</code>)') + '</li>',
        '<li>' + _('Save &amp; Apply') + '</li>',
        '</ol>',
        '<p style="margin-top:8px;color:#8c8c8c">' +
          _('This setup is only needed once. After that, NextPanel handles all node and rule updates automatically.') +
        '</p>',
        '<p style="margin-top:4px"><strong>' + _('Built-in routing rules:') + '</strong> ' +
          _('Ads blocked · AI services proxied · Streaming proxied · China direct · LAN direct · Others proxied') +
        '</p>',
        '</div>',
      ].join('');
    };

    return m.render().then(function (node) {
      // Wire up the Sync Now button after DOM is ready
      var btn = node.querySelector('#nextpanel-sync-btn');
      var statusEl = node.querySelector('#nextpanel-sync-status');
      if (btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          btn.textContent = _('Syncing…');
          if (statusEl) statusEl.textContent = '';

          callExec('/etc/init.d/nextpanel-sync', ['force_sync'])
            .then(function () {
              if (statusEl) {
                statusEl.style.color = '#52c41a';
                statusEl.textContent = _('✓ Sync complete — reload page to see updated status');
              }
            })
            .catch(function (err) {
              if (statusEl) {
                statusEl.style.color = '#ff4d4f';
                statusEl.textContent = _('✗ Sync failed: ') + (err.message || String(err));
              }
            })
            .finally(function () {
              btn.disabled = false;
              btn.textContent = _('Sync Now');
            });
        });
      }
      return node;
    });
  },

  handleSave: function (ev) {
    return this.super('handleSave', [ev]).then(function () {
      // After saving, restart the service to apply new interval/enabled setting
      return callExec('/etc/init.d/nextpanel-sync', ['restart']).catch(function () {});
    });
  },

});
