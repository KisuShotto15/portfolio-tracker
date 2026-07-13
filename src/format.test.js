import { describe, it, expect } from 'vitest';
import { monthKey, prevMonth, parseAmt, fmtUSD, escHtml } from './format.js';

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

describe('fmtUSD', () => {
  it('formatea con separador de miles y 2 decimales', () => {
    expect(fmtUSD(1234.5)).toBe('$1,234.50');
  });
  it('valores no finitos (undefined/NaN/Infinity) → $0.00, nunca $NaN', () => {
    expect(fmtUSD(undefined)).toBe('$0.00');
    expect(fmtUSD(NaN)).toBe('$0.00');
    expect(fmtUSD(Infinity)).toBe('$0.00');
  });
});

describe('escHtml', () => {
  it('escapa comilla simple ademas de & < > "', () => {
    expect(escHtml(`O'Brien <b>"x"</b> & co`)).toBe('O&#39;Brien &lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; co');
  });
});
