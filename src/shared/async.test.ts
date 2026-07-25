import assert from 'node:assert/strict';

import { test } from 'node:test';



import { fireAndForget } from './async';



test('fireAndForget reports rejections without throwing', async () => {

  const errors: unknown[] = [];

  fireAndForget(Promise.reject(new Error('boom')), (error) => {

    errors.push(error);

  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(errors.length, 1);

  assert.equal((errors[0] as Error).message, 'boom');

});



test('fireAndForget ignores fulfilled promises', async () => {

  const errors: unknown[] = [];

  fireAndForget(Promise.resolve('ok'), (error) => {

    errors.push(error);

  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(errors, []);

});



test('fireAndForget swallows sync onError failures', async () => {

  fireAndForget(Promise.reject(new Error('boom')), () => {

    throw new Error('reporter failed');

  });

  await new Promise((resolve) => setTimeout(resolve, 0));

});



test('fireAndForget swallows async onError rejections', async () => {

  fireAndForget(Promise.reject(new Error('boom')), async () => {

    throw new Error('async reporter failed');

  });

  await new Promise((resolve) => setTimeout(resolve, 0));

});


