import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  compileGraphqlEditorEnvelope,
  isGraphqlProtocol,
  parseGraphqlEditorEnvelope,
} from './graphql-envelope';

describe('graphql editor envelope', () => {
  test('isGraphqlProtocol matches trimmed graphql only', () => {
    assert.equal(isGraphqlProtocol('graphql'), true);
    assert.equal(isGraphqlProtocol(' GraphQL '), true);
    assert.equal(isGraphqlProtocol('http'), false);
    assert.equal(isGraphqlProtocol('websocket'), false);
    assert.equal(isGraphqlProtocol(''), false);
    assert.equal(isGraphqlProtocol(undefined), false);
  });

  test('parse extracts query, variables object, and operationName', () => {
    const parsed = parseGraphqlEditorEnvelope({
      type: 'json',
      text: JSON.stringify({
        query: 'query GetUsers { users { id name } }',
        variables: { id: 'ada', limit: 10 },
        operationName: 'GetUsers',
      }),
    });
    assert.equal(parsed.query, 'query GetUsers { users { id name } }');
    assert.equal(parsed.operationName, 'GetUsers');
    assert.equal(JSON.parse(parsed.variablesText).id, 'ada');
    assert.equal(JSON.parse(parsed.variablesText).limit, 10);
    assert.match(parsed.variablesText, /\n/u);
  });

  test('parse keeps a mutation document in the query field', () => {
    const mutation = 'mutation UpdateUser($id: ID!) { updateUser(id: $id) { id } }';
    const parsed = parseGraphqlEditorEnvelope({
      type: 'json',
      text: JSON.stringify({ query: mutation }),
    });
    assert.equal(parsed.query, mutation);
    assert.equal(parsed.variablesText, '{}');
    assert.equal(parsed.operationName, '');
  });

  test('parse treats missing variables as {} and missing operationName as empty', () => {
    const parsed = parseGraphqlEditorEnvelope({
      type: 'json',
      text: '{ "query": "{ ping }" }',
    });
    assert.equal(parsed.query, '{ ping }');
    assert.equal(parsed.variablesText, '{}');
    assert.equal(parsed.operationName, '');
  });

  test('parse accepts json, text, and raw bodies', () => {
    const envelope = '{ "query": "{ ping }" }';
    assert.equal(
      parseGraphqlEditorEnvelope({ type: 'text', text: envelope }).query,
      '{ ping }',
    );
    assert.equal(
      parseGraphqlEditorEnvelope({
        type: 'raw',
        text: envelope,
        contentType: 'application/json',
      }).query,
      '{ ping }',
    );
  });

  test('malformed JSON and empty body yield an empty query without dumping JSON', () => {
    assert.deepEqual(parseGraphqlEditorEnvelope(undefined), {
      query: '',
      variablesText: '{}',
      operationName: '',
    });
    assert.deepEqual(parseGraphqlEditorEnvelope({ type: 'none' }), {
      query: '',
      variablesText: '{}',
      operationName: '',
    });
    assert.deepEqual(
      parseGraphqlEditorEnvelope({ type: 'json', text: '{ not json' }),
      {
        query: '',
        variablesText: '{}',
        operationName: '',
      },
    );
    const notEnvelope = parseGraphqlEditorEnvelope({
      type: 'json',
      text: '{ "hello": true, "nested": { "a": 1 } }',
    });
    assert.equal(notEnvelope.query, '');
    assert.doesNotMatch(notEnvelope.query, /hello/u);
    assert.equal(notEnvelope.variablesText, '{}');
  });

  test('compile always includes query and pretty-prints JSON', () => {
    const body = compileGraphqlEditorEnvelope(
      'query GetUsers { users { id } }',
      '{ "id": 1 }',
      'GetUsers',
    );
    assert.equal(body.type, 'json');
    if (body.type !== 'json') {
      return;
    }
    const parsed = JSON.parse(body.text) as {
      query: string;
      variables: { id: number };
      operationName: string;
    };
    assert.equal(parsed.query, 'query GetUsers { users { id } }');
    assert.equal(parsed.variables.id, 1);
    assert.equal(parsed.operationName, 'GetUsers');
    assert.match(body.text, /\n {2}"query"/u);
  });

  test('compile omits empty operationName and uses {} for empty variables text', () => {
    const body = compileGraphqlEditorEnvelope('{ ping }', '', '  ');
    assert.equal(body.type, 'json');
    if (body.type !== 'json') {
      return;
    }
    const parsed = JSON.parse(body.text) as Record<string, unknown>;
    assert.equal(parsed.query, '{ ping }');
    assert.deepEqual(parsed.variables, {});
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed, 'operationName'),
      false,
    );
  });

  test('compile omits invalid variables JSON and keeps query and operationName', () => {
    const body = compileGraphqlEditorEnvelope(
      'query Q { ping }',
      '{ not json',
      'Q',
    );
    assert.equal(body.type, 'json');
    if (body.type !== 'json') {
      return;
    }
    const parsed = JSON.parse(body.text) as Record<string, unknown>;
    assert.equal(parsed.query, 'query Q { ping }');
    assert.equal(parsed.operationName, 'Q');
    assert.equal(
      Object.prototype.hasOwnProperty.call(parsed, 'variables'),
      false,
    );
  });

  test('round-trip compile then parse preserves query, mutation, variables, and operationName', () => {
    const query =
      'mutation UpdateUser($id: ID!, $name: String!) { updateUser(id: $id, name: $name) { id } }';
    const compiled = compileGraphqlEditorEnvelope(
      query,
      JSON.stringify({ id: '{{userId}}', name: 'Ada' }),
      'UpdateUser',
    );
    const parsed = parseGraphqlEditorEnvelope(compiled);
    assert.equal(parsed.query, query);
    assert.equal(parsed.operationName, 'UpdateUser');
    assert.deepEqual(JSON.parse(parsed.variablesText), {
      id: '{{userId}}',
      name: 'Ada',
    });
  });
});
