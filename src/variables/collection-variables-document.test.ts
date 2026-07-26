import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COLLECTION_VARIABLES_SCHEMA_VERSION,
  emptyCollectionVariablesDocument,
  parseCollectionVariablesDocument,
  serializeCollectionVariablesDocument,
} from './collection-variables-document';

describe('collection variables document', () => {
  test('empty document has current schema version and no variables', () => {
    const document = emptyCollectionVariablesDocument();
    assert.equal(document.schemaVersion, COLLECTION_VARIABLES_SCHEMA_VERSION);
    assert.deepEqual(document.variables, []);
  });

  test('round-trips a document through serialize/parse', () => {
    const document = {
      schemaVersion: COLLECTION_VARIABLES_SCHEMA_VERSION,
      variables: [
        { name: 'baseUrl', value: 'https://api.example.test' },
        { name: 'apiKey', value: '', sensitive: true },
      ],
    };
    const text = serializeCollectionVariablesDocument(document);
    const parsed = parseCollectionVariablesDocument(text);
    assert.deepEqual(parsed, document);
  });

  test('parses missing schemaVersion as current version', () => {
    const parsed = parseCollectionVariablesDocument(
      JSON.stringify({ variables: [{ name: 'x', value: 'y' }] }),
    );
    assert.deepEqual(parsed, {
      schemaVersion: COLLECTION_VARIABLES_SCHEMA_VERSION,
      variables: [{ name: 'x', value: 'y' }],
    });
  });

  test('ignores malformed variable rows', () => {
    const parsed = parseCollectionVariablesDocument(
      JSON.stringify({
        schemaVersion: 1,
        variables: [
          { name: '', value: 'skipped' },
          { value: 'no-name' },
          'not-an-object',
          { name: 'ok', value: 'v', sensitive: false },
        ],
      }),
    );
    assert.deepEqual(parsed, {
      schemaVersion: 1,
      variables: [{ name: 'ok', value: 'v' }],
    });
  });

  test('returns undefined for corrupt JSON or non-object documents', () => {
    assert.equal(parseCollectionVariablesDocument('{not json'), undefined);
    assert.equal(parseCollectionVariablesDocument('[]'), undefined);
    assert.equal(parseCollectionVariablesDocument('null'), undefined);
  });
});
