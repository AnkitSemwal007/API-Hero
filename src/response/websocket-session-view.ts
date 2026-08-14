/**
 * Secret-safe WebSocket session projection for UI, MCP, and collection reports.
 * Framework-free — no vscode. Never copies raw `sentMessage`.
 */

import { maskAssertionText } from '../assertions';
import type { WebsocketSessionSummary } from '../execution';
import { deepFreeze, scrubBodyTextForDisplay } from '../shared';

/** Matches {@link RESPONSE_TEXT_PREVIEW_LIMIT} without a presentation cycle. */
const WEBSOCKET_TEXT_PREVIEW_LIMIT = 256 * 1024;

const SESSION_HINT =
  'Bounded session: connect → send → receive → close. The socket is not kept open.';

export type PresentedWebsocketEventKind =
  | 'connection'
  | 'sent'
  | 'received'
  | 'error';

export interface PresentedWebsocketEvent {
  readonly kind: PresentedWebsocketEventKind;
  readonly direction?: 'sent' | 'received';
  readonly text: string;
}

/** Editor chrome phases. There is no live Connected state — the socket is closed. */
export type WebsocketUiPhase =
  | 'disconnected'
  | 'connecting'
  | 'closed'
  | 'error';

export interface PresentedWebsocketSession {
  readonly connected: true;
  readonly sent: boolean;
  readonly received: true;
  readonly closed: true;
  readonly closeCode?: number;
  readonly closeReason?: string;
  /** Secret-safe, size-capped preview. NEVER the raw sentMessage. */
  readonly sentPreview?: string;
  readonly receivedPreview?: string;
  readonly events: readonly PresentedWebsocketEvent[];
}

export function presentWebsocketSession(
  summary: WebsocketSessionSummary,
  receivedText: string | undefined,
): PresentedWebsocketSession {
  const sentPreview =
    summary.sent && summary.sentMessage !== undefined
      ? redactWebsocketPreview(summary.sentMessage)
      : undefined;
  const receivedPreview =
    receivedText !== undefined
      ? redactWebsocketPreview(receivedText)
      : undefined;

  const events: PresentedWebsocketEvent[] = [
    { kind: 'connection', text: 'Connected' },
  ];
  if (summary.sent) {
    events.push({
      kind: 'sent',
      direction: 'sent',
      text:
        sentPreview !== undefined && sentPreview.length > 0
          ? sentPreview
          : '(text frame sent)',
    });
  }
  events.push({
    kind: 'received',
    direction: 'received',
    text: receivedPreview ?? '',
  });
  const closeReason =
    summary.closeReason === undefined || summary.closeReason.length === 0
      ? undefined
      : redactWebsocketPreview(summary.closeReason);

  events.push({
    kind: 'connection',
    text: formatClosedEvent(summary.closeCode, closeReason),
  });

  return deepFreeze({
    connected: true,
    sent: summary.sent,
    received: true,
    closed: true,
    ...(summary.closeCode === undefined ? {} : { closeCode: summary.closeCode }),
    ...(closeReason === undefined ? {} : { closeReason }),
    ...(sentPreview === undefined ? {} : { sentPreview }),
    ...(receivedPreview === undefined ? {} : { receivedPreview }),
    events,
  });
}

export function buildWebsocketSessionView(input: {
  readonly phase: WebsocketUiPhase;
  readonly websocket?: PresentedWebsocketSession;
  readonly failureMessage?: string;
}): {
  readonly phase: WebsocketUiPhase;
  readonly statusLabel: string;
  readonly hint: string;
  readonly events: readonly PresentedWebsocketEvent[];
} {
  const websocket = input.websocket;
  let events: readonly PresentedWebsocketEvent[] = [];
  if (
    (input.phase === 'closed' || input.phase === 'error') &&
    websocket !== undefined
  ) {
    events = websocket.events;
  } else if (input.phase === 'error') {
    const message = input.failureMessage;
    if (message !== undefined && message.length > 0) {
      events = [{ kind: 'error', text: maskAssertionText(message) }];
    }
  }
  return deepFreeze({
    phase: input.phase,
    statusLabel: statusLabelForPhase(input.phase),
    hint: SESSION_HINT,
    events,
  });
}

function statusLabelForPhase(phase: WebsocketUiPhase): string {
  switch (phase) {
    case 'disconnected':
      return 'Disconnected';
    case 'connecting':
      return 'Connecting';
    case 'closed':
      return 'Closed';
    case 'error':
      return 'Error';
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

function formatClosedEvent(
  closeCode: number | undefined,
  closeReason: string | undefined,
): string {
  if (
    closeCode !== undefined &&
    closeReason !== undefined &&
    closeReason.length > 0
  ) {
    return `Closed (${closeCode} ${closeReason})`;
  }
  if (closeCode !== undefined) {
    return `Closed (${closeCode})`;
  }
  if (closeReason !== undefined && closeReason.length > 0) {
    return `Closed (${closeReason})`;
  }
  return 'Closed';
}

function redactWebsocketPreview(text: string): string {
  const truncated =
    text.length > WEBSOCKET_TEXT_PREVIEW_LIMIT
      ? text.slice(0, WEBSOCKET_TEXT_PREVIEW_LIMIT)
      : text;
  return maskAssertionText(scrubBodyTextForDisplay(truncated));
}
