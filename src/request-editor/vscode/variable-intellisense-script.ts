/**
 * Client-side variable IntelliSense script fragment for the Request Editor webview.
 * Kept as a string so CSP-safe inline script generation stays unit-testable.
 */

import { MASKED_VARIABLE_VALUE, VARIABLE_SCOPE_UI } from '../../variables';
import { AH_ICON_SVG } from '../../ui/webview';

/**
 * Icons the Request Editor client script renders dynamically (var-suggest
 * popup + Dependencies pin/remove chrome). This string is spliced directly
 * into the outer Request Editor IIFE (see `request-editor-html.ts`).
 * `ahIconSpan` / `AH_ICON_SVG_MAP` are the single client-side icon helpers —
 * do not redefine `ahIconSpan` elsewhere in that IIFE.
 */
const AH_ICON_SVG_SUBSET: Readonly<Record<string, string>> = Object.freeze({
  play: AH_ICON_SVG.play,
  'file-text': AH_ICON_SVG['file-text'],
  globe: AH_ICON_SVG.globe,
  package: AH_ICON_SVG.package,
  folder: AH_ICON_SVG.folder,
  network: AH_ICON_SVG.network,
  lock: AH_ICON_SVG.lock,
  pin: AH_ICON_SVG.pin,
  x: AH_ICON_SVG.x,
});

/** JavaScript body (no IIFE wrapper) injected into the Request Editor webview. */
export const VARIABLE_INTELLISENSE_SCRIPT = `
  var DOCUMENT_SCOPE_UI = ${JSON.stringify({
    sourceLabel: VARIABLE_SCOPE_UI.document.sourceLabel,
    icon: VARIABLE_SCOPE_UI.document.iconName,
  })};
  var MASKED_VAR = ${JSON.stringify(MASKED_VARIABLE_VALUE)};
  var AH_ICON_SVG_MAP = ${JSON.stringify(AH_ICON_SVG_SUBSET)};

  function ahIconSpan(iconName, className) {
    var markup = AH_ICON_SVG_MAP[iconName];
    if (!markup) return '';
    var cls = 'ah-icon' + (className ? ' ' + className : '');
    return '<span class="' + cls + '" aria-hidden="true">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      markup + '</svg></span>';
  }
  var varSuggestEl = el('varSuggest');
  var varCatalog = [];
  var varActive = null;
  var varItems = [];
  var varIndex = -1;
  var varTarget = null;

  function fuzzyMatchVar(query, candidate) {
    if (!query) return true;
    var q = String(query).toLowerCase();
    var c = String(candidate).toLowerCase();
    var qi = 0;
    for (var i = 0; i < c.length && qi < q.length; i += 1) {
      if (c[i] === q[qi]) qi += 1;
    }
    return qi === q.length;
  }

  function takeNamePrefix(value) {
    var out = '';
    for (var i = 0; i < value.length; i += 1) {
      var ch = value.charAt(i);
      if (!/[A-Za-z0-9_.$-]/.test(ch)) break;
      out += ch;
    }
    return out;
  }

  function analyzeVarInput(text, cursor) {
    var safe = Math.max(0, Math.min(cursor, text.length));
    var before = text.slice(0, safe);
    var openIdx = before.lastIndexOf('{{');
    var closeIdx = before.lastIndexOf('}}');
    if (openIdx < 0 || openIdx < closeIdx) {
      return { isActive: false, prefix: '', replaceStart: safe, replaceEnd: safe };
    }
    var afterOpen = before.slice(openIdx + 2);
    var prefix = takeNamePrefix(afterOpen);
    var replaceStart = openIdx + 2;
    var trailing = takeNamePrefix(text.slice(safe));
    var replaceEnd = safe + trailing.length;
    var closeAfter = text.indexOf('}}', replaceStart);
    if (closeAfter >= 0 && closeAfter < replaceEnd) replaceEnd = closeAfter;
    if (replaceEnd < replaceStart + prefix.length) {
      replaceEnd = replaceStart + prefix.length;
    }
    return { isActive: true, prefix: prefix, replaceStart: replaceStart, replaceEnd: replaceEnd };
  }

  function effectiveVarCatalog() {
    var byName = {};
    (varCatalog || []).forEach(function (item) {
      byName[item.name] = item;
    });
    var liveVariables = [];
    try {
      liveVariables = readVariables();
    } catch (_error) {
      liveVariables = state && state.model && state.model.variables
        ? state.model.variables
        : [];
    }
    (liveVariables || []).forEach(function (row) {
      var name = (row.name || '').trim();
      if (!name) return;
      byName[name] = {
        name: name,
        scope: 'document',
        sourceLabel: DOCUMENT_SCOPE_UI.sourceLabel,
        icon: DOCUMENT_SCOPE_UI.icon,
        sensitive: row.sensitive === true,
        description: row.sensitive
          ? DOCUMENT_SCOPE_UI.sourceLabel + ' · sensitive'
          : DOCUMENT_SCOPE_UI.sourceLabel,
        valuePreview: row.sensitive ? undefined : row.value
      };
    });
    return Object.keys(byName).sort().map(function (key) { return byName[key]; });
  }

  function filterVarItems(prefix) {
    return effectiveVarCatalog().filter(function (item) {
      return fuzzyMatchVar(prefix, item.name);
    });
  }

  function hideVarSuggest() {
    varSuggestEl.hidden = true;
    varSuggestEl.innerHTML = '';
    varActive = null;
    varItems = [];
    varIndex = -1;
    varTarget = null;
  }

  function renderVarDetail(item) {
    if (!item) return '';
    var value = item.sensitive
      ? MASKED_VAR
      : (item.valuePreview != null && item.valuePreview !== '' ? item.valuePreview : '(empty)');
    return '<div class="var-suggest-detail">' +
      '<div class="var-suggest-name"></div>' +
      '<div class="var-suggest-meta"></div>' +
      '<div class="var-suggest-value-label">Current Value</div>' +
      '<div class="var-suggest-value"></div>' +
      '<div class="var-suggest-sensitive"></div>' +
      '</div>';
  }

  function fillVarDetail(root, item) {
    if (!root || !item) return;
    root.querySelector('.var-suggest-name').textContent = item.name;
    var metaEl = root.querySelector('.var-suggest-meta');
    metaEl.innerHTML = '';
    metaEl.appendChild(document.createTextNode('Effective source: '));
    metaEl.insertAdjacentHTML('beforeend', ahIconSpan(item.icon));
    if (item.sensitive) {
      metaEl.insertAdjacentHTML('beforeend', ahIconSpan('lock', 'ah-icon--muted'));
    }
    metaEl.appendChild(document.createTextNode(' ' + (item.sourceLabel || '')));
    root.querySelector('.var-suggest-value').textContent = item.sensitive
      ? MASKED_VAR
      : (item.valuePreview != null && item.valuePreview !== '' ? item.valuePreview : '(empty)');
    root.querySelector('.var-suggest-sensitive').textContent =
      'Sensitive: ' + (item.sensitive ? 'Yes' : 'No');
  }

  function positionVarSuggest(target) {
    var rect = target.getBoundingClientRect();
    varSuggestEl.style.left = Math.max(8, rect.left) + 'px';
    varSuggestEl.style.top = (rect.bottom + 4) + 'px';
    varSuggestEl.style.minWidth = Math.max(220, Math.min(rect.width, 420)) + 'px';
  }

  function showVarSuggest(target, context) {
    varItems = filterVarItems(context.prefix);
    varTarget = target;
    varActive = context;
    if (varItems.length === 0) {
      hideVarSuggest();
      return;
    }
    varIndex = 0;
    varSuggestEl.innerHTML = '';
    var list = document.createElement('div');
    list.className = 'var-suggest-list';
    list.setAttribute('role', 'presentation');
    varItems.forEach(function (item, index) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'var-suggest-item' + (index === 0 ? ' active' : '');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
      row.innerHTML =
        '<span class="var-suggest-icon"></span>' +
        '<span class="var-suggest-label"></span>' +
        '<span class="var-suggest-source"></span>';
      row.querySelector('.var-suggest-icon').innerHTML =
        ahIconSpan(item.icon) + (item.sensitive ? ahIconSpan('lock', 'ah-icon--muted') : '');
      row.querySelector('.var-suggest-label').textContent = item.name;
      row.querySelector('.var-suggest-source').textContent = item.sourceLabel || '';
      row.addEventListener('mousedown', function (event) {
        event.preventDefault();
        acceptVarSuggest(index);
      });
      row.addEventListener('mouseenter', function () {
        setVarIndex(index);
      });
      list.appendChild(row);
    });
    varSuggestEl.appendChild(list);
    var detailWrap = document.createElement('div');
    detailWrap.innerHTML = renderVarDetail(varItems[0]);
    varSuggestEl.appendChild(detailWrap.firstChild);
    fillVarDetail(varSuggestEl.querySelector('.var-suggest-detail'), varItems[0]);
    positionVarSuggest(target);
    varSuggestEl.hidden = false;
  }

  function setVarIndex(index) {
    if (index < 0 || index >= varItems.length) return;
    varIndex = index;
    varSuggestEl.querySelectorAll('.var-suggest-item').forEach(function (node, i) {
      var active = i === index;
      node.classList.toggle('active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    fillVarDetail(varSuggestEl.querySelector('.var-suggest-detail'), varItems[index]);
  }

  function acceptVarSuggest(index) {
    if (!varTarget || !varActive || index < 0 || index >= varItems.length) return;
    var item = varItems[index];
    var text = varTarget.value || '';
    var after = text.slice(varActive.replaceEnd);
    var insert = item.name;
    if (!after.startsWith('}}')) insert += '}}';
    varTarget.value =
      text.slice(0, varActive.replaceStart) + insert + text.slice(varActive.replaceEnd);
    var caret = varActive.replaceStart + insert.length;
    varTarget.focus();
    if (typeof varTarget.setSelectionRange === 'function') {
      varTarget.setSelectionRange(caret, caret);
    }
    hideVarSuggest();
    scheduleUpdate();
    updateFieldVarChrome(varTarget);
  }

  function refreshVarSuggestFor(target, force) {
    if (!target || target.disabled) {
      hideVarSuggest();
      return;
    }
    var value = target.value || '';
    var cursor = typeof target.selectionStart === 'number'
      ? target.selectionStart
      : value.length;
    var context = analyzeVarInput(value, cursor);
    if (!context.isActive) {
      hideVarSuggest();
      return;
    }
    if (!force && context.prefix === '' && value.slice(context.replaceStart - 2, context.replaceStart) !== '{{') {
      hideVarSuggest();
      return;
    }
    showVarSuggest(target, context);
  }

  function resolveInlinePreview(text) {
    var catalog = effectiveVarCatalog();
    var byName = {};
    catalog.forEach(function (item) { byName[item.name] = item; });
    var matched = false;
    var hasSensitive = false;
    var unknown = [];
    var resolved = String(text).replace(/\\{\\{(\\$?[A-Za-z_][A-Za-z0-9_.-]*)\\}\\}/g, function (_m, name) {
      matched = true;
      var item = byName[name];
      if (!item) {
        unknown.push(name);
        return '{{' + name + '}}';
      }
      if (item.sensitive) {
        hasSensitive = true;
        return MASKED_VAR;
      }
      return item.valuePreview != null ? item.valuePreview : '';
    });
    if (!matched) return null;
    return { resolved: resolved, hasSensitive: hasSensitive, unknown: unknown };
  }

  function suggestCorrection(name) {
    var best = null;
    effectiveVarCatalog().forEach(function (item) {
      if (!fuzzyMatchVar(name, item.name)) return;
      if (!best || item.name.length < best.length) best = item.name;
    });
    return best;
  }

  function updateFieldVarChrome(target) {
    if (!target) return;
    var previewId = target.getAttribute('data-var-preview');
    var hintId = target.getAttribute('data-var-hint');
    var preview = previewId ? el(previewId) : null;
    var hint = hintId ? el(hintId) : null;
    var info = resolveInlinePreview(target.value || '');
    if (preview) {
      if (!info) {
        preview.hidden = true;
        preview.textContent = '';
        preview.removeAttribute('title');
        preview.removeAttribute('aria-label');
      } else {
        preview.hidden = false;
        var resolvedLabel = 'Resolved: ' + info.resolved;
        preview.textContent = resolvedLabel;
        preview.title = resolvedLabel;
        preview.setAttribute('aria-label', resolvedLabel);
      }
    }
    if (hint) {
      if (!info || !info.unknown || info.unknown.length === 0) {
        hint.hidden = true;
        hint.textContent = '';
      } else {
        var name = info.unknown[0];
        var correction = suggestCorrection(name);
        hint.hidden = false;
        hint.textContent = correction
          ? 'Unknown variable {{' + name + '}} — Did you mean: ' + correction + '?'
          : 'Unknown variable {{' + name + '}}';
      }
    }
  }

  function isVarCompleteField(node) {
    return !!(node && node.matches && node.matches('[data-var-complete="true"]'));
  }

  function onVarInput(event) {
    var target = event.target;
    if (!isVarCompleteField(target)) return;
    updateFieldVarChrome(target);
    refreshVarSuggestFor(target, false);
  }

  function onVarKeyDown(event) {
    var target = event.target;
    if (!isVarCompleteField(target)) return;

    if (event.key === 'Escape' && !varSuggestEl.hidden) {
      event.preventDefault();
      hideVarSuggest();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
      event.preventDefault();
      refreshVarSuggestFor(target, true);
      return;
    }

    if (varSuggestEl.hidden) {
      if (event.key === '{') {
        window.setTimeout(function () {
          refreshVarSuggestFor(target, false);
        }, 0);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setVarIndex(Math.min(varItems.length - 1, varIndex + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setVarIndex(Math.max(0, varIndex - 1));
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (varIndex >= 0) {
        event.preventDefault();
        acceptVarSuggest(varIndex);
      }
      return;
    }
    if (event.key === '}') {
      window.setTimeout(function () {
        var context = analyzeVarInput(target.value || '', target.selectionStart || 0);
        if (!context.isActive) hideVarSuggest();
      }, 0);
    }
  }

  function onVarBlur() {
    window.setTimeout(function () {
      if (!varSuggestEl.contains(document.activeElement)) {
        hideVarSuggest();
      }
    }, 120);
  }

  function bindVarComplete(node) {
    if (!node || node.getAttribute('data-var-bound') === 'true') return;
    node.setAttribute('data-var-bound', 'true');
    node.setAttribute('data-var-complete', 'true');
    node.addEventListener('input', onVarInput);
    node.addEventListener('keydown', onVarKeyDown);
    node.addEventListener('click', function () { refreshVarSuggestFor(node, false); });
    node.addEventListener('blur', onVarBlur);
  }

  function bindAllVarFields() {
    bindVarComplete(el('url'));
    bindVarComplete(el('bodyText'));
    bindVarComplete(el('testValue'));
    document.querySelectorAll(
      '#headersTable [data-v], #paramsTable [data-v], #formTable [data-v], #multipartTable [data-v], #variablesTable [data-v], #variablesTable [data-k]'
    ).forEach(bindVarComplete);
    updateFieldVarChrome(el('url'));
  }

  function setVarCatalog(items) {
    varCatalog = Array.isArray(items) ? items.slice() : [];
    if (document.activeElement && isVarCompleteField(document.activeElement)) {
      updateFieldVarChrome(document.activeElement);
    } else {
      updateFieldVarChrome(el('url'));
    }
  }

  document.addEventListener('scroll', function () {
    if (!varSuggestEl.hidden && varTarget) positionVarSuggest(varTarget);
  }, true);
  window.addEventListener('resize', function () {
    if (!varSuggestEl.hidden && varTarget) positionVarSuggest(varTarget);
  });
`;
