import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WebsocketSessionSummary } from '../execution';
import {
  buildWebsocketSessionView,
  presentWebsocketSession,
} from './websocket-session-view';

const CLOSED_SUMMARY: WebsocketSessionSummary = {
  connected: true,
  sent: true,
  received: true,
  closed: true,
  closeCode: 1000,
  closeReason: 'Normal Closure',
  sentMessage:
    '{"type":"auth","accessToken":"super-secret-ws","authorization":"Bearer leaked-ws-token"}',
};

test('presentWebsocketSession recaps a completed session without copying sentMessage', () => {
  const presented = presentWebsocketSession(
    CLOSED_SUMMARY,
    '{"type":"pong","accessToken":"received-secret"}',
  );
  assert.equal(presented.connected, true);
  assert.equal(presented.sent, true);
  assert.equal(presented.received, true);
  assert.equal(presented.closed, true);
  assert.equal(presented.closeCode, 1000);
  assert.equal(presented.closeReason, 'Normal Closure');
  assert.equal('sentMessage' in presented, false);
  assert.ok(presented.sentPreview !== undefined);
  assert.ok(presented.receivedPreview !== undefined);
  assert.doesNotMatch(JSON.stringify(presented), /super-secret-ws/u);
  assert.doesNotMatch(JSON.stringify(presented), /leaked-ws-token/u);
  assert.doesNotMatch(JSON.stringify(presented), /received-secret/u);
  assert.doesNotMatch(JSON.stringify(presented), /Bearer leaked/u);
  const kinds = presented.events.map((event) => event.kind);
  assert.deepEqual(kinds, ['connection', 'sent', 'received', 'connection']);
  assert.equal(presented.events[0]?.text, 'Connected');
  assert.equal(presented.events[1]?.direction, 'sent');
  assert.equal(presented.events[2]?.direction, 'received');
  assert.match(presented.events[3]?.text ?? '', /^Closed \(1000/u);
});

test('presentWebsocketSession redacts secrets in closeReason', () => {
  const presented = presentWebsocketSession(
    {
      connected: true,
      sent: false,
      received: true,
      closed: true,
      closeCode: 1008,
      closeReason: 'Bearer leaked-close-token rejected',
    },
    'ok',
  );
  assert.equal(presented.closeReason !== undefined, true);
  assert.doesNotMatch(presented.closeReason ?? '', /leaked-close-token/u);
  assert.doesNotMatch(
    presented.events.map((event) => event.text).join('\n'),
    /leaked-close-token/u,
  );
});

test('presentWebsocketSession omits sent preview when no message was sent', () => {
  const presented = presentWebsocketSession(
    {
      connected: true,
      sent: false,
      received: true,
      closed: true,
    },
    'hello',
  );
  assert.equal(presented.sent, false);
  assert.equal(presented.sentPreview, undefined);
  assert.equal(
    presented.events.some((event) => event.kind === 'sent'),
    false,
  );
  assert.equal(presented.receivedPreview, 'hello');
});

test('buildWebsocketSessionView maps disconnected connecting closed error without a live Connected phase', () => {
  const disconnected = buildWebsocketSessionView({ phase: 'disconnected' });
  assert.equal(disconnected.phase, 'disconnected');
  assert.equal(disconnected.statusLabel, 'Disconnected');
  assert.match(disconnected.hint, /not kept open/u);
  assert.equal(disconnected.events.length, 0);

  const connecting = buildWebsocketSessionView({ phase: 'connecting' });
  assert.equal(connecting.phase, 'connecting');
  assert.equal(connecting.statusLabel, 'Connecting');
  assert.notEqual(connecting.statusLabel, 'Connected');
  assert.equal(connecting.events.length, 0);

  const presented = presentWebsocketSession(CLOSED_SUMMARY, '{"type":"pong"}');
  const closed = buildWebsocketSessionView({
    phase: 'closed',
    websocket: presented,
  });
  assert.equal(closed.phase, 'closed');
  assert.equal(closed.statusLabel, 'Closed');
  assert.ok(closed.events.some((event) => event.kind === 'sent'));
  assert.ok(closed.events.some((event) => event.kind === 'received'));

  const errored = buildWebsocketSessionView({
    phase: 'error',
    failureMessage: 'Authorization: Bearer leaked-ws-token failed',
  });
  assert.equal(errored.phase, 'error');
  assert.equal(errored.statusLabel, 'Error');
  assert.equal(errored.events[0]?.kind, 'error');
  assert.doesNotMatch(JSON.stringify(errored.events), /leaked-ws-token/u);
});
