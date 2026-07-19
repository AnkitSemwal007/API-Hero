import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as orchestration from './index';

test('neutral orchestration barrel loads without the VS Code runtime', () => {
  assert.equal(typeof orchestration.ExecutionOrchestrator, 'function');
  assert.equal(typeof orchestration.RequestSelectionError, 'function');
  assert.equal(typeof orchestration.selectRequestAtOffset, 'function');
  assert.equal(
    Object.keys(orchestration).some((name) => name.startsWith('VsCode')),
    false,
  );
});
