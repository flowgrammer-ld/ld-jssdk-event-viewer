/**
 * Shared panel rendering and interaction logic for the LaunchDarkly
 * SDK Event Viewer.  Used by both the Chrome DevTools extension
 * (panel.js) and the bookmarklet (bookmarklet/panel.js).
 *
 * Usage:
 *   var core = LDPanelCore.create({
 *     root: document | shadowRoot,   // DOM root for queries
 *     logEditor: { insert(msg), setValue(msg) }
 *   });
 *   core.setup();          // wire buttons, filters, collapsible sections
 *   core.handleEval(d);    // process an eval response
 *   core.handleSent(d);    // process a sent-events payload
 *   …
 *
 * Requires: shared/ld-utils.js (window.LDUtils)
 */
(function (exports) {
  'use strict';

  var U = window.LDUtils;

  exports.create = function (config) {
    var root = config.root;          // document or shadowRoot
    var logEditor = config.logEditor;

    // ── DOM helpers ──────────────────────────────────────────────
    function $(sel)  { return root.querySelector(sel); }
    function $$(sel) { return root.querySelectorAll(sel); }
    function on$(sel, evt, fn) { var el = $(sel); if (el) el.addEventListener(evt, fn); }

    // ── State ────────────────────────────────────────────────────
    var state = {
      streamConnections: new Map(),
      eventsData: []
    };

    // ── Setup (buttons, filters, toggles, etc.) ──────────────────
    function setup() {
      on$('#clearBtn', 'click', function () { clearAllData(); showToast('All data cleared', 'success'); });
      on$('#exportBtn', 'click', function () { exportData(); showToast('Data exported', 'success'); });
      setupCollapsible();
      setupCopy();
      setupViewToggles();
      setupEventFilters();
      initEmptyStates();
    }

    // ── Collapsible sections ─────────────────────────────────────
    function setupCollapsible() {
      $$('.section-header').forEach(function (hdr) {
        hdr.addEventListener('click', function (e) {
          if (e.target.classList.contains('copy-btn') || e.target.classList.contains('toggle-btn')) return;
          var tgt = hdr.getAttribute('data-target');
          var content = $('#' + tgt);
          if (content) { hdr.classList.toggle('collapsed'); content.classList.toggle('collapsed'); }
        });
      });
    }

    // ── Copy buttons ─────────────────────────────────────────────
    function setupCopy() {
      $$('.copy-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var sel = btn.getAttribute('data-copy-target');
          var el = root.querySelector(sel);
          if (el && el.value && el.value.trim()) {
            navigator.clipboard.writeText(el.value).then(function () {
              btn.classList.add('copied'); btn.textContent = 'Copied!';
              setTimeout(function () { btn.classList.remove('copied'); btn.textContent = 'Copy'; }, 2000);
            }).catch(function () { showToast('Copy failed', 'error'); });
          } else {
            showToast('Nothing to copy', 'warning');
          }
        });
      });
    }

    // ── View toggles (raw / formatted) ───────────────────────────
    function setupViewToggles() {
      $$('.toggle-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var view = btn.getAttribute('data-view');
          var key = btn.getAttribute('data-container');
          var sec = btn.closest('.collapsible-section');
          sec.querySelectorAll('.toggle-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');

          var map = {
            context:            ['contextRawView',            'contextFormattedView'],
            events:             ['eventsRawView',             'eventsFormattedView'],
            flagsInExperiment:  ['flagsInExperimentRawView',  'flagsInExperimentFormattedView'],
            conversionMetrics:  ['conversionMetricsRawView',  'conversionMetricsFormattedView'],
            flags:              ['flagsRawView',              'flagsFormattedView']
          };
          var ids = map[key];
          if (!ids) return;
          var rawV = $('#' + ids[0]), fmtV = $('#' + ids[1]);
          var empty = sec.querySelector('.empty-state');
          var ta = sec.querySelector('textarea');
          if (ta && ta.value && ta.value.trim()) {
            rawV.style.display = view === 'raw' ? 'block' : 'none';
            fmtV.style.display = view === 'raw' ? 'none' : 'block';
            if (empty) empty.classList.add('hidden');
          }
        });
      });
    }

    // ── Event filters ────────────────────────────────────────────
    function setupEventFilters() {
      $$('.filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          $$('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          filterEvents(btn.getAttribute('data-filter'));
        });
      });
    }

    function filterEvents(f) {
      $$('.event-card').forEach(function (c) {
        var dir = c.getAttribute('data-direction');
        var typ = c.getAttribute('data-event-type');
        var show = f === 'all' || (f === 'received' || f === 'sent' ? dir === f : typ === f);
        c.classList.toggle('hidden', !show);
      });
    }

    // ── Empty states ─────────────────────────────────────────────
    function initEmptyStates() {
      $$('textarea').forEach(function (ta) { updateEmptyState(ta); });
    }

    function updateEmptyState(ta) {
      var sel = ta.id ? '#' + ta.id : (ta.className ? '.' + ta.className.split(' ')[0] : '');
      var es = root.querySelector('.empty-state[data-for="' + sel + '"]');
      if (!es) return;
      if (ta.value && ta.value.trim()) {
        es.classList.add('hidden'); ta.style.display = 'block';
      } else {
        es.classList.remove('hidden'); ta.style.display = 'none';
      }
    }

    // ── Toast ────────────────────────────────────────────────────
    function showToast(msg, type) {
      var c = $('#toast-container');
      if (!c) return;
      var t = document.createElement('div');
      t.className = 'toast ' + (type || 'info');
      t.textContent = msg;
      c.appendChild(t);
      setTimeout(function () { t.remove(); }, 3000);
    }

    // ── Show section view helper ─────────────────────────────────
    function showSectionView(containerId, emptyId, rawId, fmtId) {
      var es = $('#' + emptyId);
      if (es) es.classList.add('hidden');
      var container = $('#' + containerId);
      if (!container) return;
      var active = container.querySelector('.toggle-btn.active');
      if (!active) return;
      var v = active.getAttribute('data-view');
      var rv = $('#' + rawId), fv = $('#' + fmtId);
      if (rv && fv) {
        rv.style.display = v === 'raw' ? 'block' : 'none';
        fv.style.display = v === 'raw' ? 'none' : 'block';
      }
    }

    // ── Detail row helper ────────────────────────────────────────
    function detailRow(key, val) {
      if (val == null) return '';
      var display = typeof val === 'string' && val.startsWith('<') ? val : U.escapeHtml(String(val));
      return '<div class="event-detail-row"><span class="event-detail-key">' + U.escapeHtml(key) +
        '</span><span class="event-detail-value">' + display + '</span></div>';
    }

    // ── Feature Flags table ──────────────────────────────────────
    function updateFlagsTable(data) {
      var tb = $('#featureFlagsTableBody');
      if (!tb) return;
      tb.innerHTML = '';
      var n = data ? Object.keys(data).length : 0;
      var badge = $('#featureFlagsCount');
      if (badge) { badge.textContent = n; badge.setAttribute('data-count', n); }
      if (!n) { tb.innerHTML = '<div class="data-table-empty">No flags yet</div>'; return; }
      for (var k in data) {
        var f = data[k];
        var row = document.createElement('div'); row.className = 'data-table-row';
        ['key', 'value', 'reason'].forEach(function (col) {
          var cell = document.createElement('div'); cell.className = 'data-table-cell';
          if (col === 'key') cell.textContent = k;
          else if (col === 'value') cell.innerHTML = U.formatFlagValue(f.value);
          else cell.innerHTML = U.formatFlagReason(f.reason);
          row.appendChild(cell);
        });
        tb.appendChild(row);
      }
    }

    // ── Context table ────────────────────────────────────────────
    function updateContextTable(ctx) {
      var c = $('#contextTableContainer');
      if (!c) return;
      c.innerHTML = '';
      if (!ctx || !Object.keys(ctx).length) { c.innerHTML = '<div class="data-table-empty">No context</div>'; return; }

      var rootAttrs = {}, groups = {};
      for (var k in ctx) {
        var v = ctx[k];
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) groups[k] = v;
        else rootAttrs[k] = v;
      }

      if (Object.keys(rootAttrs).length) {
        var rd = document.createElement('div'); rd.className = 'context-root';
        for (var rk in rootAttrs) {
          var item = document.createElement('div'); item.className = 'context-root-item';
          item.innerHTML = '<span class="context-root-key">' + U.escapeHtml(rk) + ':</span>' +
            '<span class="context-root-value">' + U.escapeHtml(String(rootAttrs[rk])) + '</span>';
          rd.appendChild(item);
        }
        c.appendChild(rd);
      }

      for (var gn in groups) {
        var g = groups[gn];
        var gd = document.createElement('div'); gd.className = 'context-group';
        var gh = document.createElement('div'); gh.className = 'context-group-header';
        gh.innerHTML = '<span>' + U.escapeHtml(gn) + '</span>' +
          (g.key ? '<span class="context-kind-badge">' + U.escapeHtml(g.key) + '</span>' : '');
        gd.appendChild(gh);

        var gb = document.createElement('div'); gb.className = 'context-group-body';
        for (var ak in g) {
          var av = g[ak];
          var ad = document.createElement('div'); ad.className = 'context-attribute';
          var kd = document.createElement('div'); kd.className = 'context-attr-key'; kd.textContent = ak;
          var vd = document.createElement('div'); vd.className = 'context-attr-value';
          if (av === true) vd.innerHTML = '<span class="value-true">true</span>';
          else if (av === false) vd.innerHTML = '<span class="value-false">false</span>';
          else if (ak === 'key') vd.innerHTML = '<span class="value-key">' + U.escapeHtml(String(av)) + '</span>';
          else if (typeof av === 'string') vd.innerHTML = '<span class="value-string">' + U.escapeHtml(av) + '</span>';
          else vd.innerHTML = U.escapeHtml(JSON.stringify(av));
          ad.appendChild(kd); ad.appendChild(vd); gb.appendChild(ad);
        }
        gd.appendChild(gb); c.appendChild(gd);
      }
    }

    // ── Flags in Experiment table ────────────────────────────────
    function updateExpFlagsTable(flags) {
      if (!flags || !Object.keys(flags).length) return;
      var raw = $('#flagsInExperimentRaw');
      if (raw) raw.value = JSON.stringify(flags, null, 2);
      var tb = $('#flagsInExperimentTableBody');
      if (tb) {
        tb.innerHTML = '';
        for (var k in flags) {
          var f = flags[k];
          var row = document.createElement('div'); row.className = 'data-table-row';
          [k, 'value', 'reason', 'variation'].forEach(function (col, i) {
            var cell = document.createElement('div'); cell.className = 'data-table-cell';
            if (i === 0) cell.textContent = k;
            else if (col === 'value') cell.innerHTML = U.formatFlagValue(f.value);
            else if (col === 'reason') cell.innerHTML = U.formatFlagReason(f.reason);
            else cell.textContent = f.variation != null ? f.variation : '\u2014';
            row.appendChild(cell);
          });
          tb.appendChild(row);
        }
      }
      var es = $('#flagsInExperimentEmptyState');
      if (es) es.classList.add('hidden');
      showSectionView('flagsInExperimentSection', 'flagsInExperimentEmptyState', 'flagsInExperimentRawView', 'flagsInExperimentFormattedView');
    }

    // ── Conversion Metrics table ─────────────────────────────────
    function updateConversionTable(goals) {
      if (!goals || !goals.length) return;
      var raw = $('#conversionMetricsRaw');
      if (raw) raw.value = JSON.stringify(goals, null, 2);
      var tb = $('#conversionMetricsTableBody');
      if (tb) {
        tb.innerHTML = '';
        goals.forEach(function (g) {
          var enabled = g.urlMatch && (g.targetMatch === 'N/A' ? true : g.targetMatch);
          var row = document.createElement('div'); row.className = 'data-table-row';
          var sc = document.createElement('div'); sc.className = 'data-table-cell';
          sc.innerHTML = enabled ? '<span class="status-badge status-enabled">Enabled</span>' : '<span class="status-badge status-disabled">Disabled</span>';
          row.appendChild(sc);
          var kc = document.createElement('div'); kc.className = 'data-table-cell';
          kc.innerHTML = '<span class="metric-kind-badge">' + U.escapeHtml(g.kind || '') + '</span>';
          row.appendChild(kc);
          var keyc = document.createElement('div'); keyc.className = 'data-table-cell'; keyc.textContent = g.key || '';
          row.appendChild(keyc);
          var uc = document.createElement('div'); uc.className = 'data-table-cell';
          uc.innerHTML = g.urlMatch ? '<span class="value-true">true</span>' : '<span class="value-false">false</span>';
          row.appendChild(uc);
          var tc = document.createElement('div'); tc.className = 'data-table-cell';
          tc.innerHTML = g.targetMatch === 'N/A' ? '<span style="color:#999;">N/A</span>' : (g.targetMatch ? '<span class="value-true">true</span>' : '<span class="value-false">false</span>');
          row.appendChild(tc);
          tb.appendChild(row);
        });
      }
      var es = $('#conversionMetricsEmptyState');
      if (es) es.classList.add('hidden');
      showSectionView('conversionMetricsSection', 'conversionMetricsEmptyState', 'conversionMetricsRawView', 'conversionMetricsFormattedView');
    }

    // ── Timeline ─────────────────────────────────────────────────
    function addTimelineEvent(evt) {
      var tl = $('#eventsTimeline');
      if (!tl) return;
      state.eventsData.push(evt);
      var card = makeCard(evt);
      tl.insertBefore(card, tl.firstChild);
      var af = root.querySelector('.filter-btn.active');
      if (af) {
        var f = af.getAttribute('data-filter');
        if (f !== 'all') {
          var dir = card.getAttribute('data-direction');
          var typ = card.getAttribute('data-event-type');
          var show = (f === 'received' || f === 'sent') ? dir === f : typ === f;
          if (!show) card.classList.add('hidden');
        }
      }
      updateFilterCounts();
      showSectionView('networkDetailsContainer', 'eventsEmptyState', 'eventsRawView', 'eventsFormattedView');
    }

    function updateFilterCounts() {
      var evts = state.eventsData;
      var c = { all: evts.length, received: 0, sent: 0, identify: 0, feature: 0, custom: 0, summary: 0 };
      evts.forEach(function (e) {
        if (e.direction === 'received') c.received++;
        if (e.direction === 'sent') c.sent++;
        if (e.type === 'identify') c.identify++;
        if (e.type === 'feature') c.feature++;
        if (e.type === 'custom') c.custom++;
        if (e.type === 'summary') c.summary++;
      });
      Object.keys(c).forEach(function (k) {
        var el = $('#filter-count-' + k);
        if (el) el.textContent = c[k];
      });
    }

    function makeCard(evt) {
      var card = document.createElement('div');
      card.className = 'event-card collapsed';
      card.setAttribute('data-direction', evt.direction);
      card.setAttribute('data-event-type', evt.type || 'received');

      var hdr = document.createElement('div');
      hdr.className = 'event-card-header';
      hdr.onclick = function () { card.classList.toggle('collapsed'); };

      var di = document.createElement('span'); di.className = 'event-direction';
      di.textContent = evt.direction === 'received' ? '\u2B07\uFE0F' : '\u2B06\uFE0F';
      hdr.appendChild(di);

      var db = document.createElement('span');
      db.className = 'event-type-badge ' + evt.direction;
      db.textContent = evt.direction;
      hdr.appendChild(db);

      if (evt.type && evt.type !== 'received') {
        var tb = document.createElement('span');
        tb.className = 'event-type-badge ' + evt.type;
        tb.textContent = evt.type;
        hdr.appendChild(tb);
      }

      var ks = document.createElement('span'); ks.className = 'event-key';
      ks.textContent = evt.key || evt.description || '';
      hdr.appendChild(ks);

      // Extension-only: HAR timing stats in header
      if (evt.timings && config.createTimingStats) {
        var stats = config.createTimingStats(evt);
        if (stats) hdr.appendChild(stats);
      }

      var tsp = document.createElement('span'); tsp.className = 'event-timestamp';
      tsp.textContent = evt.timestamp;
      hdr.appendChild(tsp);

      var ei = document.createElement('span'); ei.className = 'event-expand-icon';
      hdr.appendChild(ei);

      var body = document.createElement('div');
      body.className = 'event-card-body';
      body.innerHTML = cardBody(evt);

      // Extension-only: HAR timing click handlers
      if (config.attachTimingHandlers) {
        config.attachTimingHandlers(body);
      }

      card.appendChild(hdr);
      card.appendChild(body);
      return card;
    }

    function cardBody(evt) {
      var h = '';
      if (evt.url) h += '<div class="event-url">' + U.escapeHtml(evt.url) + '</div>';
      if (evt.direction === 'received') {
        if (evt.data && typeof evt.data === 'object') h += detailRow('Flags', Object.keys(evt.data).length + ' flag(s) evaluated');
        if (evt.bodySize) h += detailRow('Payload Size', U.formatByteSize(evt.bodySize));
        // Extension-only: HAR timing display
        if (evt.timings && config.createTimingDisplay) {
          h += config.createTimingDisplay(evt.timings);
        }
      } else if (evt.type === 'feature') {
        h += detailRow('Flag Key', evt.key);
        h += detailRow('Value', U.formatEventValue(evt.data && evt.data.value));
        h += detailRow('Variation', evt.data && evt.data.variation);
        if (evt.data && evt.data.reason) h += detailRow('Reason', U.formatFlagReason(evt.data.reason));
      } else if (evt.type === 'custom') {
        h += detailRow('Metric Key', evt.key);
        if (evt.data && evt.data.metricValue != null) h += detailRow('Metric Value', evt.data.metricValue);
      } else if (evt.type === 'identify' && evt.data && evt.data.context) {
        h += detailRow('Context Kind', evt.data.context.kind || 'user');
      } else if (evt.type === 'summary' && evt.data && evt.data.features) {
        h += '<div class="summary-features">';
        for (var fk in evt.data.features) {
          var feat = evt.data.features[fk];
          h += '<div class="summary-feature"><div class="summary-feature-key">' + U.escapeHtml(fk) + '</div>';
          if (feat.counters) feat.counters.forEach(function (ct) {
            h += detailRow('Value', U.formatEventValue(ct.value) + ' (' + ct.count + 'x)');
          });
          h += '</div>';
        }
        h += '</div>';
      }
      return h || '<div style="color:#999;font-style:italic;">No additional details</div>';
    }

    // ── Counter helpers ──────────────────────────────────────────
    function bumpCounters(typeCounts) {
      Object.keys(typeCounts).forEach(function (k) {
        var el = $('#' + k + '-value');
        if (!el) return;
        var nv = parseInt(el.textContent) + typeCounts[k];
        if (nv !== parseInt(el.textContent)) { el.textContent = nv; U.animateCounter(el); }
      });
    }

    function countTypes(events) {
      return events.reduce(function (a, c) {
        switch (c.kind) {
          case 'identify': a.identify++; break;
          case 'custom':   a.custom++; break;
          case 'click':    a.click++; break;
          case 'feature':  a.feature++; break;
          case 'summary':  a.feature = Object.keys(c.features || {}).length; break;
        }
        return a;
      }, { custom: 0, click: 0, identify: 0, feature: 0 });
    }

    // ── Clear / Export ───────────────────────────────────────────
    function clearAllData() {
      $$('span.type-counter').forEach(function (c) { c.textContent = 0; });
      logEditor.setValue('');
      $$('textarea').forEach(function (t) { t.value = ''; updateEmptyState(t); });
      state.streamConnections.clear();
      state.eventsData = [];

      ['conversionMetricsSection', 'flagsInExperimentSection', 'experimentGoals'].forEach(function (id) {
        var el = $('#' + id); if (el) el.style.display = 'none';
      });
      var ftb = $('#featureFlagsTableBody'); if (ftb) ftb.innerHTML = '';
      var fc = $('#featureFlagsCount'); if (fc) { fc.textContent = '0'; fc.setAttribute('data-count', '0'); }

      ['flagsEmptyState', 'contextEmptyState', 'eventsEmptyState',
       'flagsInExperimentEmptyState', 'conversionMetricsEmptyState'].forEach(function (id) {
        var el = $('#' + id); if (el) el.classList.remove('hidden');
      });
      ['flagsRawView', 'flagsFormattedView', 'contextRawView', 'contextFormattedView',
       'eventsRawView', 'eventsFormattedView', 'flagsInExperimentRawView',
       'flagsInExperimentFormattedView', 'conversionMetricsRawView',
       'conversionMetricsFormattedView'].forEach(function (id) {
        var el = $('#' + id); if (el) el.style.display = 'none';
      });
      var ctc = $('#contextTableContainer'); if (ctc) ctc.innerHTML = '';
      var etl = $('#eventsTimeline'); if (etl) etl.innerHTML = '';

      $$('.filter-btn').forEach(function (b) {
        b.classList.remove('active');
        if (b.getAttribute('data-filter') === 'all') b.classList.add('active');
      });
      updateFilterCounts();
      var cid = $('#clientIDValue'); if (cid) cid.textContent = '';
    }

    function exportData() {
      var obj = {
        exportedAt: new Date().toISOString(),
        context: (root.querySelector('.user-context-details') || {}).value || '',
        featureFlags: (root.querySelector('.featureflags-details') || {}).value || '',
        events: ($('#networkDetails') || {}).value || '',
        experimentGoals: (root.querySelector('.experiments-details') || {}).value || '',
        counters: {}
      };
      ['custom', 'identify', 'click', 'feature'].forEach(function (k) {
        obj.counters[k] = ($('#' + k + '-value') || {}).textContent || '0';
      });
      obj.counters.experiments = ($('#experiments-value') || {}).textContent || '0';
      obj.counters.experimentGoals = ($('#experiments-goal-value') || {}).textContent || '0';
      obj.counters.streamConnections = ($('#streamConnection-value') || {}).textContent || '0';
      obj.counters.streamEvents = ($('#streamevent-value') || {}).textContent || '0';

      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ld-sdk-events-' + Date.now() + '.json';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    }

    // ── Event handlers (called by extension or bookmarklet) ──────
    function updateUserContext(url) {
      var ctx = U.parseUrlForContext(url);
      var ta = root.querySelector('.user-context-details');
      if (!ctx || !ta) return;
      ta.value += (ta.value ? ',' : '') + JSON.stringify(ctx, null, 4);
      updateEmptyState(ta);
      updateContextTable(ctx);

      var es = $('#contextEmptyState'); if (es) es.classList.add('hidden');
      var at = root.querySelector('#userContextContainer .toggle-btn.active');
      if (at) {
        var v = at.getAttribute('data-view');
        var rv = $('#contextRawView'), fv = $('#contextFormattedView');
        rv.style.display = v === 'raw' ? 'block' : 'none';
        fv.style.display = v === 'raw' ? 'none' : 'block';
      }

      var clientId = U.parseClientIDFromUrl(url);
      var cidEl = $('#clientIDValue');
      if (cidEl) cidEl.textContent = 'Client-side ID: ' + clientId;
    }

    function handleEval(d) {
      updateUserContext(d.url);

      var expFlags = U.getFlagsInExperiment(d.data);
      var expCount = Object.keys(expFlags).length;
      var expEl = $('#experiments-value');
      if (expEl) { expEl.textContent = expCount; U.animateCounter(expEl); }
      if (expCount > 0) {
        var s = $('#flagsInExperimentSection'); if (s) s.style.display = 'block';
        updateExpFlagsTable(expFlags);
      }

      var fta = root.querySelector('.featureflags-details');
      if (fta) { fta.value = JSON.stringify(d.data, null, 2); updateEmptyState(fta); }
      updateFlagsTable(d.data);
      showSectionView('featureFlagsContainer', 'flagsEmptyState', 'flagsRawView', 'flagsFormattedView');

      logEditor.insert(
        '\n======== [' + d.timestamp + '] RECEIVE EVENT START ========\n' +
        (d.method || 'GET') + ' url[' + d.url + ']\n' + JSON.stringify(d.data) +
        '\n======== RECEIVE EVENT END   ========\n'
      );

      addTimelineEvent({
        direction: 'received', type: 'received', timestamp: d.timestamp,
        url: d.url, description: Object.keys(d.data).length + ' flags',
        data: d.data, timings: d.timings, bodySize: d.bodyLength || d.bodySize
      });
    }

    function handleSent(d) {
      try {
        var events = typeof d.body === 'string' ? JSON.parse(d.body) : d.events;
        if (!Array.isArray(events) || !events.length) return;

        logEditor.insert(
          '\n======== [' + d.timestamp + '] SENT EVENT START ========\n' +
          'POST url[' + d.url + ']\n' + JSON.stringify(events) +
          '\n======== SENT EVENT END   ========\n'
        );

        bumpCounters(countTypes(events));

        events.forEach(function (evt) {
          var ed = { direction: 'sent', type: evt.kind || 'unknown', timestamp: d.timestamp, key: evt.key || '', data: evt };
          if (evt.kind === 'identify') ed.description = 'User identified';
          else if (evt.kind === 'feature') ed.description = evt.key;
          else if (evt.kind === 'custom') { ed.description = evt.key; if (evt.metricValue != null) ed.description += ' (' + evt.metricValue + ')'; }
          else if (evt.kind === 'summary') { ed.description = Object.keys(evt.features || {}).length + ' flag(s) summarized'; }
          addTimelineEvent(ed);
        });
      } catch (e) { /* ignore */ }
    }

    function handleGoals(d, locationInfo) {
      if (!d.data || !d.data.length) return;
      var href = locationInfo ? locationInfo.href : window.location.href;
      var search = locationInfo ? locationInfo.search : window.location.search;
      var hash = locationInfo ? locationInfo.hash : window.location.hash;

      var collection = d.data.map(function (goal) {
        var matched = (goal.urls || []).filter(function (u) { return U.doesUrlMatch(u, href, search, hash); });
        return {
          kind: goal.kind || '', key: goal.key || '', selector: goal.selector,
          urlMatch: matched.length > 0,
          targetMatch: goal.kind === 'pageview' ? 'N/A' : (goal.selector ? !!document.querySelector(goal.selector) : false),
          urls: goal.urls
        };
      });

      if (collection.length) {
        var cms = $('#conversionMetricsSection'); if (cms) cms.style.display = 'block';
        var egs = $('#experimentGoals'); if (egs) egs.style.display = 'block';
      }
      updateConversionTable(collection);

      var enabled = collection.filter(function (c) { return c.urlMatch && (c.targetMatch === true || c.targetMatch === 'N/A'); });
      var gel = $('#experiments-goal-value');
      if (gel) { gel.textContent = parseInt(gel.textContent) + enabled.length; U.animateCounter(gel); }
    }

    function handleStreamOpen(d) {
      if (!d.hash || state.streamConnections.has(d.hash)) return;
      state.streamConnections.set(d.hash, { url: d.url, status: 'active', eventCount: 0 });
      var el = $('#streamConnection-value');
      if (el) {
        var n = 0; state.streamConnections.forEach(function (c) { if (c.status === 'active') n++; });
        el.textContent = n; U.animateCounter(el);
      }
      logEditor.insert(
        '\n======== [' + d.timestamp + '] Stream Connection Detected ========\n' +
        'URL: ' + d.url + '\nClient-side ID: ' + d.clientId + '\nContext Hash: ' + d.hash +
        '\nContext: ' + JSON.stringify(d.context, null, 4) +
        '\n======== Stream Connection End ========\n'
      );
    }

    function handleStreamEvent(d) {
      var conn = state.streamConnections.get(d.hash);
      if (conn) conn.eventCount++;
      var el = $('#streamevent-value');
      if (el) {
        var total = 0;
        state.streamConnections.forEach(function (c) { total += c.eventCount || 0; });
        el.textContent = total; U.animateCounter(el);
      }
    }

    // ── Public API ───────────────────────────────────────────────
    return {
      root: root,
      setup: setup,
      state: state,
      showToast: showToast,
      updateEmptyState: updateEmptyState,

      // Event handlers
      handleEval: handleEval,
      handleSent: handleSent,
      handleGoals: handleGoals,
      handleStreamOpen: handleStreamOpen,
      handleStreamEvent: handleStreamEvent,

      // For direct use by extension handlers
      updateFlagsTable: updateFlagsTable,
      updateContextTable: updateContextTable,
      updateExpFlagsTable: updateExpFlagsTable,
      updateConversionTable: updateConversionTable,
      updateUserContext: updateUserContext,
      addTimelineEvent: addTimelineEvent,
      bumpCounters: bumpCounters,
      countTypes: countTypes,
      clearAllData: clearAllData,
      exportData: exportData,
      showSectionView: showSectionView
    };
  };

})(window.LDPanelCore = window.LDPanelCore || {});
