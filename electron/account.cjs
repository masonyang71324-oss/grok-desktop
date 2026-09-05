const { translate: t } = require('./i18n.cjs');
// Mirrors the official read-only billing extension and its proto3 zero default.
// Payment caps and session token counts are different measures from plan usage.
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value) => (typeof value === 'string' && value.trim() ? value : null);
function cents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  // Official Cent.val has a serde default because proto3 encodes zero as {}.
  const amount = Object.hasOwn(value, 'val') ? number(value.val) : 0;
  // Billing uses signed ledger amounts; the official credit display uses magnitude.
  return amount === null ? null : Math.abs(amount) / 100;
}

function normalizeAccountUsage(result, now = new Date()) {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error(t('Grok 未返回有效的套餐信息。'));
  if (result.error != null)
    throw new Error(
      typeof result.error === 'string'
        ? result.error
        : result.error.message || t('无法读取套餐信息。'),
    );
  const config = result.config || {};
  const percentage = number(config.creditUsagePercent);
  const period = config.currentPeriod;
  const periodStart = Date.parse(period?.start);
  const periodEnd = Date.parse(period?.end);
  const activePeriod =
    ['USAGE_PERIOD_TYPE_WEEKLY', 'USAGE_PERIOD_TYPE_MONTHLY'].includes(period?.type) &&
    periodStart <= now.getTime() &&
    now.getTime() < periodEnd;
  // GrokCreditsConfig.credit_usage_percent is an implicit-presence proto3 float:
  // zero is omitted on the wire. Match the official web client only when a
  // successful unified-billing response identifies the current active period.
  const omittedZero =
    !Object.hasOwn(config, 'creditUsagePercent') &&
    config.isUnifiedBillingUser === true &&
    activePeriod;
  const usedPercent = percentage !== null && percentage >= 0 ? percentage : omittedZero ? 0 : null;
  return {
    fetchedAt: now.toISOString(),
    plan: text(result.subscription_tier),
    period: {
      type: text(config.currentPeriod?.type),
      start: text(config.currentPeriod?.start),
      end: text(config.currentPeriod?.end),
    },
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    prepaidBalanceUsd: cents(config.prepaidBalance),
    onDemandUsedUsd: cents(config.onDemandUsed),
    onDemandCapUsd: cents(config.onDemandCap),
    onDemandEnabled:
      typeof result.on_demand_enabled === 'boolean' ? result.on_demand_enabled : null,
    unified: typeof config.isUnifiedBillingUser === 'boolean' ? config.isUnifiedBillingUser : null,
  };
}

async function readAccountUsage(client) {
  return normalizeAccountUsage(await client.extension('_x.ai/billing', {}));
}

module.exports = { normalizeAccountUsage, readAccountUsage };
