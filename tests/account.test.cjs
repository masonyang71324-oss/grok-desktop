const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAccountUsage, readAccountUsage } = require('../electron/account.cjs');

test('an active unified period restores the omitted proto3 zero percentage', () => {
  const result = normalizeAccountUsage(
    {
      subscription_tier: 'SuperGrok Heavy',
      config: {
        currentPeriod: {
          type: 'USAGE_PERIOD_TYPE_WEEKLY',
          start: '2026-09-03T03:38:46Z',
          end: '2026-09-10T03:38:46Z',
        },
        prepaidBalance: { val: 0 },
        onDemandCap: {},
        onDemandUsed: { val: 0 },
        isUnifiedBillingUser: true,
      },
    },
    new Date('2026-09-05T00:00:00Z'),
  );
  assert.equal(result.plan, 'SuperGrok Heavy');
  assert.equal(result.usedPercent, 0);
  assert.equal(result.remainingPercent, 100);
  assert.equal(result.prepaidBalanceUsd, 0);
  assert.equal(result.onDemandCapUsd, 0);
  assert.equal(result.period.end, '2026-09-10T03:38:46Z');
  assert.equal(result.onDemandEnabled, null);
});

test('missing or invalid quota data cannot become a full allowance', () => {
  const now = new Date('2026-09-05T00:00:00Z');
  const currentPeriod = {
    type: 'USAGE_PERIOD_TYPE_WEEKLY',
    start: '2026-09-03T00:00:00Z',
    end: '2026-09-10T00:00:00Z',
  };
  for (const config of [
    undefined,
    {},
    { isUnifiedBillingUser: true },
    { currentPeriod },
    { currentPeriod, isUnifiedBillingUser: false },
    { currentPeriod, isUnifiedBillingUser: true, creditUsagePercent: null },
    { currentPeriod, isUnifiedBillingUser: true, creditUsagePercent: 'bad' },
    { currentPeriod, isUnifiedBillingUser: true, creditUsagePercent: -1 },
    {
      currentPeriod: { ...currentPeriod, end: '2026-09-04T00:00:00Z' },
      isUnifiedBillingUser: true,
    },
    {
      currentPeriod: { ...currentPeriod, start: '2026-09-06T00:00:00Z' },
      isUnifiedBillingUser: true,
    },
    { currentPeriod: { ...currentPeriod, start: 'bad' }, isUnifiedBillingUser: true },
  ]) {
    const result = normalizeAccountUsage({ config }, now);
    assert.equal(result.usedPercent, null);
    assert.equal(result.remainingPercent, null);
  }
});

test('explicit quota percentages include zero and do not infer usage from legacy amounts', () => {
  const zero = normalizeAccountUsage({ config: { creditUsagePercent: 0 } });
  assert.equal(zero.usedPercent, 0);
  assert.equal(zero.remainingPercent, 100);
  const used = normalizeAccountUsage({ config: { creditUsagePercent: 27.5 } });
  assert.equal(used.remainingPercent, 72.5);
  const spendingOnly = normalizeAccountUsage({
    config: { monthlyLimit: { val: 10000 }, used: { val: 2500 } },
  });
  assert.equal(spendingOnly.remainingPercent, null);
  assert.equal(spendingOnly.prepaidBalanceUsd, null);
});

test('cent values become USD while malformed and missing values stay unknown', () => {
  const result = normalizeAccountUsage({
    config: {
      prepaidBalance: { val: 12345 },
      onDemandUsed: { val: 'bad' },
      creditUsagePercent: -1,
    },
  });
  assert.equal(result.prepaidBalanceUsd, 123.45);
  assert.equal(result.onDemandUsedUsd, null);
  assert.equal(result.usedPercent, null);
});

test('signed billing ledger amounts are displayed as positive credit amounts like the official UI', () => {
  const result = normalizeAccountUsage({
    config: {
      prepaidBalance: { val: -2500 },
      onDemandUsed: { val: -315 },
      onDemandCap: { val: -10000 },
    },
  });
  assert.equal(result.prepaidBalanceUsd, 25);
  assert.equal(result.onDemandUsedUsd, 3.15);
  assert.equal(result.onDemandCapUsd, 100);
});

test('account query is a read-only official extension and rejects domain failures', async () => {
  const calls = [];
  const result = await readAccountUsage({
    extension: async (...args) => {
      calls.push(args);
      return { subscription_tier: 'SuperGrok', config: { creditUsagePercent: 10 } };
    },
  });
  assert.deepEqual(calls, [['_x.ai/billing', {}]]);
  assert.equal(result.remainingPercent, 90);
  await assert.rejects(
    readAccountUsage({
      extension: async () => ({
        error: { message: 'Login expired' },
        config: { creditUsagePercent: 0 },
      }),
    }),
    /Login expired/,
  );
});
