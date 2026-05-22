import { describe, it, expect } from 'vitest';
import { formatDuration, formatCost } from '../src/formatters';

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(300)).toBe('5m');
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(60)).toBe('1m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
    expect(formatDuration(3660)).toBe('1h 1m');
    expect(formatDuration(7200)).toBe('2h 0m');
    expect(formatDuration(5400)).toBe('1h 30m');
  });
});

describe('formatCost', () => {
  it('formats cost with dollar sign and 2 decimal places', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(1.5)).toBe('$1.50');
    expect(formatCost(0.006)).toBe('$0.01');
    expect(formatCost(123.456)).toBe('$123.46');
  });
});
