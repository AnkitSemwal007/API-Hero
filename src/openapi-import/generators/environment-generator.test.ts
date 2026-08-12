import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { OpenApiDocument } from '../openapi/types';
import { generateEnvironments } from './environment-generator';

function docWithServers(
  servers: OpenApiDocument['servers'],
): OpenApiDocument {
  return {
    openapi: '3.0.3',
    info: { title: 'Demo API', version: '1.0.0' },
    servers,
  };
}

test('marks OpenAPI server variables sensitive by name heuristic', () => {
  const { environments } = generateEnvironments(
    docWithServers([
      {
        url: 'https://{region}.example.com/{apiKey}',
        variables: {
          region: { default: 'us' },
          apiKey: { default: 'example-key' },
          token: { default: 'example-token' },
          password: { default: 'example-password' },
        },
      },
    ]),
    'demo-api',
    new Set(),
  );

  const variables = environments[0]?.variables ?? [];
  const byName = Object.fromEntries(
    variables.map((variable) => [variable.name, variable.sensitive]),
  );

  assert.equal(byName.baseUrl, false);
  assert.equal(byName.region, false);
  assert.equal(byName.apiKey, true);
  assert.equal(byName.token, true);
  assert.equal(byName.password, true);
});

test('keeps baseUrl / host / port non-sensitive', () => {
  const { environments } = generateEnvironments(
    docWithServers([{ url: 'https://api.example.com:8443/v1' }]),
    'demo-api',
    new Set(),
  );

  const variables = environments[0]?.variables ?? [];
  for (const name of ['baseUrl', 'host', 'port'] as const) {
    const match = variables.find((variable) => variable.name === name);
    assert.ok(match, `expected ${name}`);
    assert.equal(match.sensitive, false);
  }
});
