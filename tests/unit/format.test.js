import test from 'node:test';
import assert from 'node:assert/strict';

import { formatRecordAge } from '../../src/format.js';

const NOW = 1_700_000_000_000;
const ago = (ms) => formatRecordAge(NOW - ms, NOW);

test('a fresh record is just now', () => {
  assert.equal(ago(0), 'just now');
  assert.equal(ago(30_000), 'just now');
});

test('minutes, hours and days are counted', () => {
  assert.equal(ago(60_000), '1 minute ago');
  assert.equal(ago(5 * 60_000), '5 minutes ago');
  assert.equal(ago(60 * 60_000), '1 hour ago');
  assert.equal(ago(3 * 60 * 60_000), '3 hours ago');
  assert.equal(ago(24 * 60 * 60_000), '1 day ago');
  assert.equal(ago(3 * 24 * 60 * 60_000), '3 days ago');
  assert.equal(ago(60 * 24 * 60 * 60_000), '2 months ago');
});

test('a record without a time shows nothing', () => {
  assert.equal(formatRecordAge(0, NOW), '');
});
