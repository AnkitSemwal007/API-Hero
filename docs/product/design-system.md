# API Hero — Design System

**Version:** 1.2 (Final Polish)  
**Principle:** Follow **VS Code native styling**. Prefer workbench tokens over custom brand themes.  
**Applies to:** Request Editor, Response panel, New Request dialog, manager webviews, History Detail, Import Hub.  
**Related:** [`product-experience.md`](./product-experience.md) · [`component-library.md`](./component-library.md) · [`interaction-model.md`](./interaction-model.md)

Tree Views, menus, InputBoxes, and QuickPicks inherit VS Code chrome — do not restyle them.

---

## 1. Design principles (visual)

1. **Token-first** — Use `--vscode-*` CSS variables; never hard-code brand purples/glows.  
2. **Workbench density** — Compact controls; avoid large marketing padding.  
3. **One accent** — Status/method color carries meaning; chrome stays neutral.  
4. **No card theater** — Cards only when they group interactive form sections.  
5. **Theme complete** — Light, dark, and high-contrast must all work.

---

## 2. Typography

| Role | Token / rule | Notes |
| --- | --- | --- |
| UI body | `var(--vscode-font-size)` / `var(--vscode-font-family)` | Default webview text |
| Monospace | `var(--vscode-editor-font-family)` / editor font size | URLs, JSON, headers, `.api` preview |
| Section title | 11–12px, semibold | Uppercase sparingly; prefer sentence case |
| Meta / secondary | 11px, `var(--vscode-descriptionForeground)` | Descriptions, timestamps |
| Code lens-like | Editor font | Avoid inventing a second scale |

**Do not** load web fonts. Do not use Inter/Roboto stacks in webviews.

Line height: ~1.4 UI, ~1.5 monospace blocks.

---

## 3. Spacing

Base unit: **4px**.

| Token | Value | Use |
| --- | --- | --- |
| `space-1` | 4px | Icon gaps, tight inline |
| `space-2` | 8px | Field padding, table cell inset |
| `space-3` | 12px | Between fields |
| `space-4` | 16px | Section padding |
| `space-5` | 24px | Panel edge padding (max for dense UIs) |
| `space-6` | 32px | Rare; major section breaks only |

**Toolbar spacing:** 4–6px between icon buttons; 8px before a primary button group.

---

## 4. Border radius

| Element | Radius |
| --- | --- |
| Inputs, selects, buttons | 2px (match VS Code) |
| Panels / section cards | 0–2px |
| Badges / method chips | 2px |
| Dialogs | VS Code default (host-controlled) |

Avoid large rounded “pill” CTAs and floating glass cards.

---

## 5. Colors

### Semantic (from tokens)

| Role | Token examples |
| --- | --- |
| Foreground | `--vscode-foreground` |
| Muted | `--vscode-descriptionForeground` |
| Background | `--vscode-editor-background` / `--vscode-sideBar-background` |
| Input bg | `--vscode-input-background` |
| Input border | `--vscode-input-border` / contrastBorder |
| Focus | `--vscode-focusBorder` |
| Link | `--vscode-textLink-foreground` |
| Error | `--vscode-errorForeground` / `inputValidation-error*` |
| Warning | `--vscode-editorWarning-foreground` |
| Success | Prefer testing/charts green tokens or `--vscode-testing-iconPassed` where available |

### Status colors (HTTP)

| Range | Guidance |
| --- | --- |
| 2xx | Success / passed testing green |
| 3xx | Warning / info muted accent |
| 4xx | Error foreground |
| 5xx | Error foreground (stronger weight / icon) |
| Cancelled | Description foreground + `circle-slash` icon |

### Method colors

Use restrained badges (background = transparent or list hover; text colored):

| Method | Guidance |
| --- | --- |
| GET | Blue-ish (`--vscode-charts-blue` or terminal.ansiBlue) |
| POST | Green-ish (`--vscode-charts-green`) |
| PUT | Orange/amber (`--vscode-charts-orange`) |
| PATCH | Purple/charts purple if available; else orange |
| DELETE | Red (`--vscode-charts-red` / error) |
| HEAD/OPTIONS | Muted foreground |
| CUSTOM | Foreground |

Never rely on color alone — always show the method text.

---

## 6. Icon usage

| Context | Rule |
| --- | --- |
| Activity Bar / Trees | `ThemeIcon` only (product SVG for container) |
| Webview actions | Codicon font via VS Code recommended approach, or inline SVG using `currentColor` |
| Size | 16px standard; 12–14px in dense tables |
| Meaning | Prefer familiar VS Code metaphors (play, refresh, trash, gear) |

Do not ship emoji as UI icons.

---

## 7. Theme support

| Theme | Requirement |
| --- | --- |
| Dark+ / Light+ | First-class |
| High Contrast | Borders visible; do not remove outlines; verify badge contrast |
| Custom themes | Token-only styling so they inherit |

Test webviews under at least one dark, one light, and one high-contrast theme before shipping a surface.

---

## 8. Badges

### MethodBadge

- Text: method string  
- Padding: 2px 6px  
- Font: 11px semibold monospace optional  
- Color: per method map  

### StatusBadge

- Text: status code or `-`  
- Icon optional (pass/error)  
- Color: per HTTP range  

### DurationBadge

- Text: `123 ms` / `1.2 s`  
- Muted foreground  
- Monospace numbers  

### Env / Auth chips (status bar & toolbars)

- Compact; clickable; never show secrets  

---

## 9. Tables

| Rule | Detail |
| --- | --- |
| Header | Subtle; descriptionForeground |
| Rows | Hover = `--vscode-list-hoverBackground` |
| Borders | Hairline via contrastBorder or separator |
| Checkbox column | 24–28px |
| Actions column | Icon buttons on row hover or always-visible in dense mode |
| Empty table | Inline empty hint + “Add” button |

Component: `KeyValueTable` — [`component-library.md`](./component-library.md).

---

## 10. Cards / SectionCard

Use **only** to group form sections inside webviews (e.g. “Request”, “Auth”).

| Property | Value |
| --- | --- |
| Background | Transparent or slightly elevated editorWidget |
| Border | 1px contrastBorder |
| Padding | 12–16px |
| Title | 12px semibold |
| Shadow | None (or VS Code widget shadow token if required) |

Do not use cards in Response hero or Collections trees.

---

## 11. Forms

| Element | Spec |
| --- | --- |
| Label | Above field; 11–12px |
| Input height | ~24–26px |
| Gap label→input | 4px |
| Gap fields | 12px |
| Validation | Error border + message below; use inputValidation tokens |
| Required | Indicate in label text, not color alone |

---

## 12. Dialogs

Prefer VS Code `InputBox` / `QuickPick` / message modals for simple flows.

Webview dialogs (New Request, managers):

- Max width ~480–560px for forms; managers may be wider panels  
- Primary button rightmost  
- Esc cancels  
- No nested dialogs ([`interaction-model.md`](./interaction-model.md))

---

## 13. Toolbar

| Rule | Detail |
| --- | --- |
| Height | ~28–32px content |
| Icon buttons | 22–24px hit target |
| Separator | 1px vertical, 8px margin |
| Primary (Run) | May use button styling with prominent foreground |
| Placement | Left: navigation/primary; Right: secondary/view options |

---

## 14. Empty states

| Element | Spec |
| --- | --- |
| Title | One short sentence |
| Body | One supporting sentence max |
| Actions | 1–3 buttons (primary first) |
| Illustration | Optional simple codicon — no large art |

Match Collections/History welcome tone.

---

## 15. Loading states

| Context | Pattern |
| --- | --- |
| Run / import | VS Code `withProgress` |
| Webview fetch | Inline spinner / skeleton rows (token-colored bars) |
| Tree refresh | Prefer silent; no full-panel blocker |

Never block the entire workbench.

---

## 16. Error states

| Context | Pattern |
| --- | --- |
| Form | Inline field errors |
| Panel | Error card with message + optional “Open Output” |
| Tree command | Notification error |
| Assertions | Pass/fail list + Problems |

---

## 17. Responsive behavior

Webviews live in resizable editors/panels:

| Width | Behavior |
| --- | --- |
| < 400px | Stack toolbars; collapse secondary actions into menu |
| 400–800px | Default single column forms |
| > 800px | Optional two-column managers (list | detail) |

Tables: horizontal scroll beats squashed columns. Do not assume mobile phone layouts.

---

## 18. Accessibility rules

| Rule | Detail |
| --- | --- |
| Focus | Visible `focusBorder`; never `outline: none` without replacement |
| Contrast | Text/badge contrast AA against backgrounds |
| Keyboard | Tab order matches visual order; Enter activates primary |
| Labels | Every input has a label; icon buttons have `aria-label` / title |
| Live regions | Announce run completion sparingly |
| Secrets | Announce “Secret set” / “Missing”, never values |
| Motion | No essential info only in animation |

Full interaction a11y: [`interaction-model.md`](./interaction-model.md) § Accessibility.

---

## 19. CSS starter contract (webview)

```css
:root {
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}
button, input, select, textarea {
  font: inherit;
  color: var(--vscode-input-foreground);
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent);
}
button.primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}
```

CSP: `default-src 'none'`; nonce for script/style — [`technical-constraints.md`](./technical-constraints.md).

---

## 20. Layout grid (webviews)

| Region | Spec |
| --- | --- |
| Panel edge padding | 12–16px (`space-3`–`space-4`) |
| Section gap | 16px |
| Toolbar sticky | Top of panel; 28–32px content height |
| Split managers | List pane 240–280px; detail fills remainder |
| Max readable line | ~72ch for prose; tables full width |

Request Editor tabs: content scrolls inside tab body; toolbar stays visible.

---

## 21. Elevation & borders

| Layer | Treatment |
| --- | --- |
| Page / panel bg | `--vscode-editor-background` |
| SectionCard | 1px `--vscode-panel-border` / contrastBorder; no shadow |
| Dropdown / menu | Host-controlled (QuickPick) or `editorWidget` tokens |
| Modal webview | Host frame; inner content flat |

Do not invent multi-layer drop shadows.

---

## 22. Focus rings

| Rule | Detail |
| --- | --- |
| Visible focus | Always use `--vscode-focusBorder` (2px outline or box-shadow) |
| Never | `outline: none` without an equivalent replacement |
| Tab order | Matches visual left→right, top→bottom |
| Skip | Esc returns focus to workbench where panel closes |

---

## 23. Status bar chips

| Chip | Content | Click |
| --- | --- | --- |
| Env | `$(globe) env-name` or `No env` | Switch Environment / open Env Manager |
| Auth (optional) | `$(key) profile` or omitted | Select Auth / open Auth Manager |
| Run (transient) | Running / status text | None or cancel |

Chips never display secret values. Use descriptionForeground when idle; foreground when active.

---

## 24. Scroll & overflow

- Prefer panel scroll over nested scroll traps.  
- Tables: sticky header optional; horizontal scroll for many columns.  
- JSONViewer: collapse deep nodes; do not auto-expand huge trees.  
- Code panes: monospace; wrap off by default for Raw.

---

## 25. Anti-patterns

- Purple gradient marketing themes  
- Heavy drop shadows / glow accents  
- Pill-shaped filter chips as primary nav  
- Custom scrollbars that fight the workbench  
- Hard-coded hex that breaks high contrast  
- Activity Bar icons that look like a second product brand inside the same extension  

---

## Token checklist (before shipping a webview)

- [ ] No hard-coded brand hex for chrome  
- [ ] Light + dark + high-contrast smoke check  
- [ ] Focus visible on all interactive controls  
- [ ] Icon buttons have tooltips / aria-labels  
- [ ] Empty / loading / error states defined  
- [ ] CSP: no remote fonts/scripts  

---

## Related documents

- [`component-library.md`](./component-library.md)  
- [`ui-components.md`](./ui-components.md)  
- [`product-experience.md`](./product-experience.md)  
- [`interaction-model.md`](./interaction-model.md)  
