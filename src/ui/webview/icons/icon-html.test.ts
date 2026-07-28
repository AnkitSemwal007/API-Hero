import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AH_ICON_SVG } from './svg';
import { iconHtml } from './icon-html';
import type { AhIconName } from './types';

test('iconHtml renders a stroke-based 24x24 svg wrapped in .ah-icon', () => {
  const html = iconHtml('play');
  assert.match(html, /^<span class="ah-icon" aria-hidden="true">/u);
  assert.match(html, /<svg width="14" height="14" viewBox="0 0 24 24"/u);
  assert.match(html, /fill="none"/u);
  assert.match(html, /stroke="currentColor"/u);
  assert.match(html, /stroke-width="2"/u);
  assert.match(html, /stroke-linecap="round"/u);
  assert.match(html, /stroke-linejoin="round"/u);
  assert.match(html, /<\/svg><\/span>$/u);
});

test('iconHtml defaults to decorative (aria-hidden) when no title is given', () => {
  const html = iconHtml('check-circle');
  assert.match(html, /aria-hidden="true"/u);
  assert.doesNotMatch(html, /role="img"/u);
  assert.doesNotMatch(html, /<title>/u);
});

test('iconHtml adds an accessible name when title is provided', () => {
  const html = iconHtml('lock', { title: 'Sensitive' });
  assert.match(html, /role="img" aria-label="Sensitive"/u);
  assert.match(html, /<title>Sensitive<\/title>/u);
  assert.doesNotMatch(html, /aria-hidden/u);
});

test('iconHtml forces aria-hidden when decorative is set even with a title', () => {
  const html = iconHtml('pin', { title: 'Pinned', decorative: true });
  assert.match(html, /aria-hidden="true"/u);
  assert.doesNotMatch(html, /role="img"/u);
});

test('iconHtml respects a custom size', () => {
  const html = iconHtml('x', { size: 20 });
  assert.match(html, /<svg width="20" height="20" viewBox="0 0 24 24"/u);
});

test('iconHtml appends and escapes extra class names', () => {
  const html = iconHtml('search', { className: 'ah-icon--muted"onload=alert(1)' });
  assert.match(html, /class="ah-icon ah-icon--muted&quot;onload=alert\(1\)"/u);
});

test('iconHtml escapes title for both attribute and text content', () => {
  const html = iconHtml('info', { title: `a"b<script>` });
  assert.match(html, /aria-label="a&quot;b&lt;script&gt;"/u);
  assert.match(html, /<title>a&quot;b&lt;script&gt;<\/title>/u);
});

test('AH_ICON_SVG exposes inner markup only (no outer svg tag) for every curated icon', () => {
  const names: readonly AhIconName[] = [
    'play',
    'check-circle',
    'x-circle',
    'alert-triangle',
    'info',
    'minus-circle',
    'pin',
    'file-text',
    'globe',
    'package',
    'folder',
    'network',
    'lock',
    'copy',
    'search',
    'x',
    'plus',
  ];
  assert.deepEqual(Object.keys(AH_ICON_SVG).sort(), [...names].sort());
  for (const name of names) {
    const markup = AH_ICON_SVG[name];
    assert.doesNotMatch(markup, /<svg/u);
    assert.doesNotMatch(markup, /<\/svg>/u);
    assert.ok(markup.length > 0);
  }
});

test('iconHtml embeds the exact vendored path markup for a given icon', () => {
  const html = iconHtml('plus');
  assert.ok(html.includes(AH_ICON_SVG.plus));
});
