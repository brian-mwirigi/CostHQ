import { describe, it, expect } from 'vitest';
import { formatDuration, formatCost, formatTokens, formatDate, formatDay } from '../dashboard/src/utils/format';

describe('formatDuration', () => {
  it('handles null and undefined', () => {
    expect(formatDuration(null)).toBe('\u2014');
    expect(formatDuration(undefined)).toBe('\u2014');
  });

  it('handles zero seconds', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('formats seconds only (< 60s)', () => {
    expect(formatDuration(1)).toBe('1s');
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(59)).toBe('59s');
  });

  it('formats minutes and seconds (60 - 3599)', () => {
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(3599)).toBe('59m 59s');
  });

  it('formats hours and minutes (>= 3600)', () => {
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(3661)).toBe('1h 1m');
    expect(formatDuration(86399)).toBe('23h 59m');
  });

  it('drops seconds for durations >= 60', () => {
    expect(formatDuration(65)).toBe('1m 5s');
  });

  it('does not prepend zero in seconds for minutes+seconds', () => {
    expect(formatDuration(61)).toBe('1m 1s');
    expect(formatDuration(3601)).toBe('1h 0m');
  });

  it('handles very large durations', () => {
    const century = 3153600000;
    const result = formatDuration(century);
    expect(typeof result).toBe('string');
    expect(result).toContain('h');
  });
});

describe('formatCost', () => {
  it('handles null and undefined', () => {
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
  });

  it('handles zero cost', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('handles NaN gracefully', () => {
    expect(formatCost(NaN)).toBe('$0.00');
  });

  it('formats whole dollars', () => {
    expect(formatCost(5)).toBe('$5.00');
    expect(formatCost(100)).toBe('$100.00');
  });

  it('formats with 2 decimal places for >= 0.01', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(0.10)).toBe('$0.10');
    expect(formatCost(123.456)).toBe('$123.46');
  });

  it('formats with 4 decimal places for < 0.01', () => {
    expect(formatCost(0.001)).toBe('$0.0010');
    expect(formatCost(0.0001)).toBe('$0.0001');
    expect(formatCost(0.0099)).toBe('$0.0099');
  });

  it('formats very large costs', () => {
    expect(formatCost(999999.99)).toBe('$999999.99');
    expect(formatCost(1000000)).toBe('$1000000.00');
  });
});

describe('formatTokens', () => {
  it('handles null and undefined', () => {
    expect(formatTokens(null)).toBe('0');
    expect(formatTokens(undefined)).toBe('0');
  });

  it('handles zero tokens', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('formats small numbers as plain integers', () => {
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(500)).toBe('500');
    expect(formatTokens(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1.0K');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(999999)).toBe('1000.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1000000)).toBe('1.0M');
    expect(formatTokens(2500000)).toBe('2.5M');
    expect(formatTokens(999999999)).toBe('1000.0M');
  });
});

describe('formatDate', () => {
  it('formats date strings correctly', () => {
    const result = formatDate('2025-06-15T14:30:00Z');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
  });

  it('handles different timezones', () => {
    const result = formatDate('2025-01-01T00:00:00Z');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(5);
  });

  it('handles end-of-year dates', () => {
    const result = formatDate('2025-12-31T23:59:59Z');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/Dec/);
  });
});

describe('formatDay', () => {
  it('formats date strings for chart display', () => {
    const result = formatDay('2025-06-15');
    expect(result).toMatch(/Jun/);
    expect(result).toMatch(/15/);
  });

  it('handles YYYY-MM-DD format with time component appended', () => {
    const result = formatDay('2025-01-01');
    expect(result).toBe('Jan 1');
  });

  it('handles full ISO strings (ignores time portion)', () => {
    const result = formatDay('2025-12-25T10:00:00Z');
    expect(result).toBe('Dec 25');
  });
});