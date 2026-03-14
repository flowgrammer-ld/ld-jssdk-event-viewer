// Extension panel – thin adapter over shared/panel-core.js
//
// Extension-specific responsibilities:
//   1. Chrome DevTools network listeners (HAR)
//   2. evalInspectPage / chrome.scripting helpers
//   3. HAR timing display (createTimingDisplay, createTimingStats)
//   4. Do-Not-Track / GPC banner
//   5. Identify-event expansion in card body (multi-kind context detail)
//
// Everything else (UI setup, tables, timeline, counters, clear/export,
// collapsible sections, copy, filters, toasts) lives in panel-core.js.

var extensionGlobals = {
  logEditor: {
    insert: function (msg) {
      var ele = document.querySelector('textArea#networkDetails');
      ele.value += '\n' + msg;
      core.updateEmptyState(ele);
    },
    setValue: function (msg) {
      var ele = document.querySelector('textArea#networkDetails');
      ele.value = msg;
      core.updateEmptyState(ele);
    }
  }
};

// ── Shared utilities (loaded via shared/ld-utils.js) ──────────────
var escapeHtml = LDUtils.escapeHtml;
var formatByteSize = LDUtils.formatByteSize;
var formatFlagValue = LDUtils.formatFlagValue;
var formatFlagReason = LDUtils.formatFlagReason;
var formatEventValue = LDUtils.formatEventValue;
var animateCounter = LDUtils.animateCounter;
var getTimestamp = LDUtils.getTimestamp;
var isLaunchDarklyUrl = LDUtils.isLaunchDarklyUrl;
var parseContextHashFromUrl = LDUtils.parseContextHashFromUrl;
var parseClientIDFromUrl = LDUtils.parseClientIDFromUrl;
var parseUrlForContext = LDUtils.parseUrlForContext;
var getFlagsInExperiment = LDUtils.getFlagsInExperiment;
var doesUrlMatch = LDUtils.doesUrlMatch;
var escapeStringRegexp = LDUtils.escapeRegex;

// ── Create the shared core (extension hooks for HAR timing) ───────
var core = LDPanelCore.create({
  root: document,
  logEditor: extensionGlobals.logEditor,
  // Extension-only: HAR timing stats shown in card headers
  createTimingStats: function (evt) {
    if (!evt.timings) return null;
    var timingKeys = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
    var totalTime = 0;
    timingKeys.forEach(function (k) { if (evt.timings[k] > 0) totalTime += evt.timings[k]; });

    var span = document.createElement('span');
    span.className = 'event-header-stats';

    var timeStr = totalTime >= 1000 ? (totalTime / 1000).toFixed(2) + 's' : Math.round(totalTime) + 'ms';
    var timeColor = totalTime > 2000 ? '#f44336' : totalTime > 500 ? '#ff9800' : '#4CAF50';
    var ts = document.createElement('span');
    ts.className = 'event-stat';
    ts.innerHTML = '<span class="stat-icon">\u23F1</span><span class="stat-value" style="color:' + timeColor + '">' + timeStr + '</span>';
    span.appendChild(ts);

    if (evt.bodySize) {
      var ss = document.createElement('span');
      ss.className = 'event-stat';
      ss.innerHTML = '<span class="stat-icon">\uD83D\uDCE6</span><span class="stat-value">' + formatByteSize(evt.bodySize) + '</span>';
      span.appendChild(ss);
    }
    return span;
  },
  // Extension-only: HAR timing breakdown in card body
  createTimingDisplay: function (timings) {
    return createTimingDisplay(timings);
  },
  // Extension-only: attach click handlers for timing sections
  attachTimingHandlers: function (body) {
    body.querySelectorAll('.timing-header').forEach(function (hdr) {
      hdr.addEventListener('click', function (e) {
        e.stopPropagation();
        var sec = hdr.closest('.timing-section');
        if (sec) sec.classList.toggle('collapsed');
      });
    });
  }
});

// ── Boot ──────────────────────────────────────────────────────────
main();

function main() {
  chrome.devtools.network.onRequestFinished.addListener(onEventSourceEvents);
  chrome.devtools.network.onRequestFinished.addListener(evalxHandler);
  chrome.devtools.network.onRequestFinished.addListener(goalsHandler);
  chrome.devtools.network.onRequestFinished.addListener(logNetwork);
  chrome.devtools.network.onRequestFinished.addListener(eventsHandler);
  chrome.devtools.network.onNavigated.addListener(onNavHandler);

  checkDoNotTrack();
  core.setup();
}

// ── HAR timing display (extension-only) ──────────────────────────
function createTimingDisplay(timings) {
  if (!timings) return '';

  var timingKeys = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
  var totalTime = 0;
  timingKeys.forEach(function (k) { if (timings[k] > 0) totalTime += timings[k]; });

  var formatTime = function (ms) {
    if (ms === undefined || ms === null || ms < 0) return '\u2014';
    if (ms < 1) return '<1 ms';
    if (ms >= 1000) return (ms / 1000).toFixed(2) + ' s';
    return Math.round(ms) + ' ms';
  };

  var getTimeColor = function (ms, type) {
    if (ms === undefined || ms === null || ms < 0) return '#999';
    if (type === 'total') {
      if (ms > 2000) return '#f44336';
      if (ms > 500) return '#ff9800';
      return '#4CAF50';
    }
    return '#666';
  };

  var timingLabels = {
    blocked: { label: 'Blocked',  desc: 'Time spent waiting in the browser queue before the request could be sent.' },
    dns:     { label: 'DNS',      desc: 'Time spent performing the DNS lookup to resolve the domain name to an IP address.' },
    connect: { label: 'Connect',  desc: 'Time spent establishing the TCP connection to the server.' },
    ssl:     { label: 'SSL',      desc: 'Time spent completing the SSL/TLS handshake for secure HTTPS connections.' },
    send:    { label: 'Send',     desc: 'Time spent sending the HTTP request to the server.' },
    wait:    { label: 'Wait',     desc: 'Time spent waiting for the server to respond (Time To First Byte - TTFB).' },
    receive: { label: 'Receive',  desc: 'Time spent receiving/downloading the response body from the server.' }
  };

  var html = '<div class="timing-section collapsed" data-timing-section="true">' +
    '<div class="timing-header">' +
    '<span class="timing-expand-icon"></span>' +
    '<span class="timing-title">Response Time</span>' +
    '<span class="timing-total" style="color:' + getTimeColor(totalTime, 'total') + '">' + formatTime(totalTime) + '</span>' +
    '</div><div class="timing-breakdown">';

  timingKeys.forEach(function (key) {
    var value = timings[key];
    var info = timingLabels[key];
    var displayValue = formatTime(value);
    var barWidth = totalTime > 0 && value > 0 ? Math.max(2, (value / totalTime) * 100) : 0;

    html += '<div class="timing-row">' +
      '<span class="timing-label">' + info.label +
      '<span class="timing-tooltip-trigger">\u24D8<span class="timing-tooltip">' + info.desc + '</span></span>' +
      '</span>' +
      '<div class="timing-bar-container"><div class="timing-bar timing-bar-' + key + '" style="width:' + barWidth + '%"></div></div>' +
      '<span class="timing-value">' + displayValue + '</span></div>';
  });

  html += '</div></div>';
  return html;
}

// ── Do-Not-Track / GPC ───────────────────────────────────────────
function checkDoNotTrack() {
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;

    chrome.scripting.executeScript({
      target: { tabId: chrome.devtools.inspectedWindow.tabId },
      func: function () {
        var gpcEnabled = navigator.globalPrivacyControl === true;
        var dntEnabled = navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes' || window.doNotTrack === '1';
        return { gpc: gpcEnabled, dnt: dntEnabled, privacySignal: gpcEnabled || dntEnabled };
      }
    }, function (result) {
      if (chrome.runtime.lastError) return;
      if (!result || !result[0]) return;
      var r = result[0].result;

      var banner = document.getElementById('dnt-status-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'dnt-status-banner';
        banner.className = 'dnt-banner';
        document.body.insertBefore(banner, document.body.firstChild);
      }

      if (r.gpc) banner.textContent = 'Global Privacy Control (GPC) is enabled in this browser.';
      else if (r.dnt) banner.textContent = 'Do Not Track (DNT) is enabled in this browser.';
      else banner.textContent = 'No privacy signal (GPC/DNT) is enabled in this browser.';

      banner.style.backgroundColor = r.privacySignal ? '#f44336' : '#4CAF50';
    });
  } catch (err) {
    // silently handle
  }
}

// ── EventSource / SSE detection ──────────────────────────────────
function onEventSourceEvents(request) {
  if (request._resourceType !== 'eventsource') return;
  var url = request.request && request.request.url;
  if (!url || url.indexOf('clientstream') === -1) return;

  var hash = parseContextHashFromUrl(url);
  if (!hash) return;
  if (core.state.streamConnections.has(hash)) return;

  var connInfo = {
    url: url,
    status: 'active',
    startTime: new Date().toISOString(),
    eventCount: 0,
    context: parseUrlForContext(url),
    clientId: parseClientIDFromUrl(url)
  };
  core.state.streamConnections.set(hash, connInfo);

  core.handleStreamOpen({
    hash: hash,
    url: url,
    timestamp: getTimestamp(),
    clientId: connInfo.clientId,
    context: connInfo.context
  });
}

// ── Navigation handler ───────────────────────────────────────────
function onNavHandler() {
  core.clearAllData();
  checkDoNotTrack();
}

// ── Eval handler ─────────────────────────────────────────────────
function evalxHandler(request) {
  var url = request.request && request.request.url;
  if (!isLaunchDarklyUrl(url)) return;
  if (url.indexOf('/sdk/eval') === -1) return;
  if (url.indexOf('/sdk/evalx/') !== -1 && request.response && request.response.content && request.response.content.size === 0) return;

  request.getContent(function (body) {
    if (!body) return;

    var bodyObj;
    try { bodyObj = JSON.parse(body); } catch (e) { return; }
    if (!bodyObj || (typeof bodyObj === 'object' && Object.keys(bodyObj).length === 0)) return;

    var timestamp = getTimestamp();
    core.handleEval({
      url: url,
      data: bodyObj,
      timestamp: timestamp,
      method: request.request.method,
      timings: request.timings,
      bodySize: body.length
    });
  });
}

// ── Sent events handler ─────────────────────────────────────────
function eventsHandler(request) {
  var url = request.request && request.request.url;
  if (!isLaunchDarklyUrl(url)) return;
  if (!request.request || request.request.method !== 'POST') return;
  if (url.indexOf('/events/bulk') === -1) return;

  var postData = request.request.postData && request.request.postData.text;
  if (!postData) return;

  core.handleSent({
    url: url,
    body: postData,
    timestamp: getTimestamp()
  });
}

// ── Goals handler ────────────────────────────────────────────────
function goalsHandler(request) {
  var url = request.request && request.request.url;
  if (!isLaunchDarklyUrl(url)) return;
  if (url.indexOf('/goals/') === -1) return;
  if (request.response && request.response.content && request.response.content.size === 0) return;

  request.getContent(function (body) {
    if (!body) return;
    var goals;
    try { goals = JSON.parse(body); } catch (e) { return; }

    Promise.allSettled([
      evalInspectPage(function () { return window.location.href; }),
      evalInspectPage(function () { return window.location.search; }),
      evalInspectPage(function () { return window.location.hash; })
    ]).then(function (results) {
      var href = (results[0].value && results[0].value[0] && results[0].value[0].result) || '';
      var search = (results[1].value && results[1].value[0] && results[1].value[0].result) || '';
      var hash = (results[2].value && results[2].value[0] && results[2].value[0].result) || '';
      core.handleGoals({ data: goals, timestamp: getTimestamp() }, { href: href, search: search, hash: hash });
    }).catch(function () {});
  });
}

// ── Network logger ───────────────────────────────────────────────
function logNetwork(request) {
  var url = request.request && request.request.url;
  if (!isLaunchDarklyUrl(url)) return;
  if (url.indexOf('/events/bulk/') === -1 && url.indexOf('/sdk/eval') === -1) return;

  new Promise(function (resolve) {
    var method = request.request && request.request.method;
    if (method === 'POST') {
      resolve((request.request.postData && request.request.postData.text) || null);
    } else if (method === 'GET') {
      request.getContent(function (body) {
        if (!body) return resolve(null);
        try {
          var parsed = JSON.parse(body);
          if (!parsed || (typeof parsed === 'object' && Object.keys(parsed).length === 0)) return resolve(null);
        } catch (e) { return resolve(null); }
        resolve(body);
      });
    } else {
      resolve(null);
    }
  }).then(function (data) {
    if (!data) return;
    var timestamp = getTimestamp();
    extensionGlobals.logEditor.insert(
      '\n======== [' + timestamp + '] EVENT START ========\n' +
      'Method: [' + request.request.method + '] URL: [' + url + ']\n' +
      JSON.stringify(data, null, 4) +
      '\n======== EVENT END   ========\n'
    );
  });
}

// ── evalInspectPage ──────────────────────────────────────────────
function evalInspectPage(code, params) {
  if (params === undefined) params = '';
  return new Promise(function (resolve, reject) {
    try {
      if (!chrome.runtime || !chrome.runtime.id) {
        reject(new Error('Extension context invalidated'));
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: chrome.devtools.inspectedWindow.tabId },
        args: [params],
        func: code
      }, function (result) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// ── Logging helpers ──────────────────────────────────────────────
function log(message) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) { console.log('[Extension context invalidated]', message); return; }
    chrome.scripting.executeScript({
      target: { tabId: chrome.devtools.inspectedWindow.tabId },
      args: [message],
      func: function (str) { console.log(str); }
    }).catch(function () { console.log('[DevTools log fallback]', message); });
  } catch (err) {
    console.log('[DevTools log fallback]', message);
  }
}

function debug(msg) {
  extensionGlobals.logEditor.insert('======== DEBUG  START ========\n');
  extensionGlobals.logEditor.insert(msg);
  extensionGlobals.logEditor.insert('======== DEBUG  END ========\n');
}
