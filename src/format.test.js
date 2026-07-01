import { describe, it, expect } from 'vitest';
import { monthKey, prevMonth, parseAmt } from './format.js';

describe('monthKey (mes local, nunca UTC)', () => {
  it('devuelve YYYY-MM con padding', () => {
    expect(monthKey(new Date(2026, 0, 15))).toBe('2026-01');
    expect(monthKey(new Date(2026, 11, 1))).toBe('2026-12');
  });
  it('usa la fecha local aunque en UTC ya sea el mes siguiente', () => {
    // 30 jun 21:00 local (UTC-4) = 1 jul 01:00 UTC; toISOString diria 2026-07
    expect(monthKey(new Date(2026, 5, 30, 21, 0))).toBe('2026-06');
  });
});

describe('prevMonth (aritmetica pura)', () => {
  it('mes anterior dentro del mismo ano', () => {
    expect(prevMonth('2026-07')).toBe('2026-06');
  });
  it('cruza el cambio de ano', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
  });
  it('mantiene el padding de dos digitos', () => {
    expect(prevMonth('2026-11')).toBe('2026-10');
  });
});

describe('parseAmt', () => {
  it('quita $ , y espacios', () => {
    expect(parseAmt('$1,234.50')).toBe(1234.5);
    expect(parseAmt(' 12 ')).toBe(12);
  });
  it('NaN y vacio → 0', () => {
    expect(parseAmt('abc')).toBe(0);
    expect(parseAmt('')).toBe(0);
    expect(parseAmt(null)).toBe(0);
  });
});
