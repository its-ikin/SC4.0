export const INVENTORY_POLICY = {
  expiryWarningDays: 90,
  expiryCriticalDays: 30,
  longDwellDays: 30,
  cycleCountIntervalDays: 14,
  liveRefreshIntervalMs: 20_000,
  staleAfterMs: 60_000,
  recentChangeMs: 8_000
} as const;

