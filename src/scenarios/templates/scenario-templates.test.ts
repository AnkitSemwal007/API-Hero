import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { serializeScenario } from '../serialization';
import { parseScenarioDocument } from '../schema';
import {
  buildScenarioFromTemplate,
  listScenarioTemplates,
  type ScenarioTemplateId,
} from './scenario-templates';

describe('scenarios/templates', () => {
  test('catalog lists P0 and P1 templates including blank secondary', () => {
    const catalog = listScenarioTemplates();
    const ids = catalog.map((t) => t.id);
    assert.ok(ids.includes('login-authenticated'));
    assert.ok(ids.includes('health-check'));
    assert.ok(ids.includes('crud-workflow'));
    assert.ok(ids.includes('blank'));
    assert.ok(ids.includes('user-registration'));
    assert.ok(ids.includes('auth-refresh'));
    assert.ok(ids.includes('smoke-test'));
    const blank = catalog.find((t) => t.id === 'blank');
    assert.equal(blank?.secondary, true);
    assert.match(
      blank?.description ?? '',
      /Empty canvas with one entry step/u,
    );
    assert.doesNotMatch(blank?.description ?? '', /Rebind request steps/u);
    assert.ok(
      catalog.every((t) => t.description.trim().length > 0),
      'every template has an outcome description',
    );
  });

  test('every template builds a schema-valid scenario', () => {
    const catalog = listScenarioTemplates();
    for (const item of catalog) {
      const scenario = buildScenarioFromTemplate(item.id, `Demo ${item.label}`);
      const parsed = parseScenarioDocument(JSON.stringify(scenario));
      assert.equal(
        parsed.ok,
        true,
        `template ${item.id} failed parse: ${
          parsed.ok ? '' : parsed.errors.join('; ')
        }`,
      );
      if (!parsed.ok) continue;
      assert.equal(parsed.scenario.name, `Demo ${item.label}`);
      assert.equal(parsed.scenario.description, item.description);
      const roundTrip = parseScenarioDocument(serializeScenario(parsed.scenario));
      assert.equal(roundTrip.ok, true, `template ${item.id} serialize round-trip`);
    }
  });

  test('blank entry uses When this workflow runs', () => {
    const scenario = buildScenarioFromTemplate('blank', 'Blank');
    assert.equal(scenario.steps[0]?.name, 'When this workflow runs');
    assert.equal(scenario.steps.length, 1);
  });

  test('login-authenticated wires token mapping steps', () => {
    const scenario = buildScenarioFromTemplate(
      'login-authenticated',
      'Auth Flow',
    );
    const types = scenario.steps.map((s) => s.type);
    assert.deepEqual(types, [
      'delay',
      'request',
      'variable',
      'request',
      'delay',
    ]);
    assert.equal(scenario.connections.length, 4);
    const variable = scenario.steps.find((s) => s.type === 'variable');
    assert.ok(variable && variable.type === 'variable');
    assert.equal(variable.assignments[0]?.name, 'token');
  });

  test('health-check condition branches reference real connections', () => {
    const scenario = buildScenarioFromTemplate('health-check', 'Health');
    const condition = scenario.steps.find((s) => s.type === 'condition');
    assert.ok(condition && condition.type === 'condition');
    const ids = new Set(scenario.connections.map((c) => c.id));
    assert.ok(ids.has(condition.trueBranch));
    assert.ok(ids.has(condition.falseBranch));
  });

  test('unknown template id is rejected at type level via runtime guard', () => {
    assert.throws(() =>
      buildScenarioFromTemplate(
        'not-a-template' as ScenarioTemplateId,
        'X',
      ),
    );
  });
});
