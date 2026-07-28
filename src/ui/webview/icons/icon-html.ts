import { escapeAttribute, escapeHtml } from '../html-escape';
import { AH_ICON_SVG } from './svg';
import type { AhIconName } from './types';

const DEFAULT_ICON_SIZE = 14;

export interface AhIconOptions {
  /** Pixel size for width/height (viewBox stays `0 0 24 24`). Default 14. */
  readonly size?: number;
  /** Extra CSS classes appended after `ah-icon`. */
  readonly className?: string;
  /** Accessible name. Adds `<title>` + `aria-label`/`role="img"`. */
  readonly title?: string;
  /** Force `aria-hidden` even when `title` is set (icon beside labelled text). */
  readonly decorative?: boolean;
}

/**
 * Renders one vendored Lucide icon as `<span class="ah-icon …"><svg>…</svg></span>`.
 * Webviews cannot load Codicon fonts, so icon markup is inline SVG (see
 * `svg.ts`) rather than an icon font or npm package.
 */
export function iconHtml(name: AhIconName, options: AhIconOptions = {}): string {
  const size = options.size ?? DEFAULT_ICON_SIZE;
  const classAttr = escapeAttribute(
    options.className === undefined || options.className.trim().length === 0
      ? 'ah-icon'
      : `ah-icon ${options.className}`,
  );
  const isDecorative = options.decorative === true || options.title === undefined;
  const accessibilityAttrs = isDecorative
    ? ' aria-hidden="true"'
    : ` role="img" aria-label="${escapeAttribute(options.title ?? '')}"`;
  const titleMarkup =
    options.title === undefined ? '' : `<title>${escapeHtml(options.title)}</title>`;
  const pathMarkup = AH_ICON_SVG[name];
  return (
    `<span class="${classAttr}"${accessibilityAttrs}>` +
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
    `stroke-linejoin="round" focusable="false">${titleMarkup}${pathMarkup}</svg>` +
    `</span>`
  );
}
