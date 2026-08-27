export function epochMilliseconds(timestamp: string): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) throw new Error(`invalid RFC 3339 timestamp: ${timestamp}`);
  return value;
}

export function utcDay(timestamp: string): string {
  return new Date(epochMilliseconds(timestamp)).toISOString().slice(0, 10);
}

export function compareTimestamps(left: string, right: string): number {
  return epochMilliseconds(left) - epochMilliseconds(right);
}
