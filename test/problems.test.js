// ProblemLog: one line when a problem starts or changes, one when it ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProblemLog } from '../src/problems.js';

function recorder() {
  const lines = [];
  const log = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (message) => lines.push([level, message]),
    ]),
  );
  return { log, lines };
}

test('a repeated failure is logged once, then at debug level', () => {
  const { log, lines } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.fail('a', 'down'), true);
  assert.equal(problems.fail('a', 'down'), false);
  assert.equal(problems.fail('a', 'down'), false);
  assert.deepEqual(lines, [
    ['warn', 'down'],
    ['debug', 'down'],
    ['debug', 'down'],
  ]);
});

test('a new message, another key or another level is logged again', () => {
  const { log, lines } = recorder();
  const problems = new ProblemLog(log);
  problems.fail('a', 'down');
  problems.fail('a', 'refused');
  problems.fail('b', 'refused', 'error');
  assert.deepEqual(lines, [
    ['warn', 'down'],
    ['warn', 'refused'],
    ['error', 'refused'],
  ]);
});

test('recovery: one info line after a logged problem, nothing otherwise', () => {
  const { log, lines } = recorder();
  const problems = new ProblemLog(log);
  assert.equal(problems.recover('a', 'back'), false);
  problems.fail('a', 'down');
  assert.equal(problems.recover('a', 'back'), true);
  assert.equal(problems.recover('a', 'back'), false);
  problems.fail('a', 'down');
  assert.equal(problems.recover('a'), true, 'a recovery without message stays silent');
  problems.fail('a', 'down');
  assert.deepEqual(lines, [
    ['warn', 'down'],
    ['info', 'back'],
    ['warn', 'down'],
    ['warn', 'down'],
  ]);
});
