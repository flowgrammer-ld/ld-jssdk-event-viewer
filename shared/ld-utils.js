/**
 * Shared utility functions for the LaunchDarkly SDK Event Viewer.
 *
 * Used by both the Chrome DevTools extension (panel.js) and the
 * bookmarklet (interceptors.js, panel.js). Exposes a single
 * global: window.LDUtils
 */
(function (exports) {
  'use strict';

  // ----------------------------------------------------------------
  // HTML / string helpers
  // ----------------------------------------------------------------

  exports.escapeHtml = function (text) {
    var d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
  };

  exports.escapeRegex = function (s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // ----------------------------------------------------------------
  // Formatting
  // ----------------------------------------------------------------

  exports.getTimestamp = function () {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  };

  exports.formatByteSize = function (bytes) {
    if (bytes === undefined || bytes === null) return '\u2014';
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB'];
    var k = 1024;
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
  };

  exports.formatFlagValue = function (value) {
    if (value === true) return '<span class="value-true">true</span>';
    if (value === false) return '<span class="value-false">false</span>';
    if (typeof value === 'string') return '<span class="value-string">"' + exports.escapeHtml(value) + '"</span>';
    if (typeof value === 'number') return '<span class="value-number">' + value + '</span>';
    if (typeof value === 'object') return '<span class="value-string">' + exports.escapeHtml(JSON.stringify(value)) + '</span>';
    return String(value);
  };

  exports.formatFlagReason = function (reason) {
    if (!reason) return '<span style="color:#999;">\u2014</span>';
    var html = '';
    if (reason.kind) html += '<span class="reason-badge reason-kind">' + exports.escapeHtml(reason.kind) + '</span>';
    if (reason.inExperiment) html += '<span class="reason-badge reason-experiment">In Experiment</span>';
    return html || '<span style="color:#999;">\u2014</span>';
  };

  exports.formatEventValue = function (value) {
    if (value === true) return '<span class="value-true">true</span>';
    if (value === false) return '<span class="value-false">false</span>';
    if (typeof value === 'string') return '"' + exports.escapeHtml(value) + '"';
    if (typeof value === 'object') return exports.escapeHtml(JSON.stringify(value));
    return String(value);
  };

  // ----------------------------------------------------------------
  // UI helpers
  // ----------------------------------------------------------------

  exports.animateCounter = function (element) {
    element.classList.add('updated');
    setTimeout(function () { element.classList.remove('updated'); }, 300);
  };

  // ----------------------------------------------------------------
  // URL parsers (LaunchDarkly SDK endpoints)
  // ----------------------------------------------------------------

  exports.isLaunchDarklyUrl = function (url) {
    if (!url) return false;
    return url.includes('launchdarkly.com') || url.includes('launchdarkly.us');
  };

  exports.parseContextHashFromUrl = function (url) {
    var section = url.split('/');
    var last = section[section.length - 1];
    if (!last || last.length === 0) return null;
    return last.split('?')[0];
  };

  exports.parseClientIDFromUrl = function (url) {
    var section = url.split('/');
    section.splice(1, 1);
    return section[section.length - 3];
  };

  exports.parseUrlForContext = function (url) {
    try {
      return JSON.parse(atob(exports.parseContextHashFromUrl(url)));
    } catch (e) {
      return {};
    }
  };

  // ----------------------------------------------------------------
  // Data helpers
  // ----------------------------------------------------------------

  exports.getFlagsInExperiment = function (flagJSON) {
    var flags = {};
    if (!flagJSON) return flags;
    for (var key in flagJSON) {
      var value = flagJSON[key];
      if (value && value.reason && value.reason.inExperiment === true) {
        flags[key] = value;
      }
    }
    return flags;
  };

  // ----------------------------------------------------------------
  // Goal tracker (from goalTracker-mod.js)
  // ----------------------------------------------------------------

  exports.doesUrlMatch = function (matcher, href, search, hash) {
    var keepHash = (matcher.kind === 'substring' || matcher.kind === 'regex') && hash.includes('/');
    var canonical = (keepHash ? href : href.replace(hash, '')).replace(search, '');
    var regex, testUrl;
    switch (matcher.kind) {
      case 'exact':     testUrl = href;      regex = new RegExp('^' + exports.escapeRegex(matcher.url) + '/?$'); break;
      case 'canonical': testUrl = canonical;  regex = new RegExp('^' + exports.escapeRegex(matcher.url) + '/?$'); break;
      case 'substring': testUrl = canonical;  regex = new RegExp('.*' + exports.escapeRegex(matcher.substring) + '.*$'); break;
      case 'regex':     testUrl = canonical;  regex = new RegExp(matcher.pattern); break;
      default: return false;
    }
    return regex.test(testUrl);
  };

})(window.LDUtils = window.LDUtils || {});
