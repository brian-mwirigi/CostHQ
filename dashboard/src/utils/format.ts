export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds === 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const remainder = seconds % 3600;
  if (remainder === 0) return `${h}h`;
  const m = Math.floor(remainder / 60);
  return `${h}h ${m}m`;
}

export function formatCost(cost: number | undefined | null): string {
  if (cost === null || cost === undefined || cost === 0 || Number.isNaN(cost)) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number | undefined | null): string {
  if (!tokens) return '0';
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function formatDay(dateStr: string): string {
  const d = dateStr.includes('T') ? new Date(dateStr) : new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
