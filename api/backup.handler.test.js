// El barrido de recibos huerfanos borra archivos: lo unico que lo separa de una
// perdida de datos es este conjunto de "referenciados". Los dos formatos tienen
// que contar — el nuevo (receiptPath) y el viejo (receiptUrl, con el pathname
// adentro de la URL) — o el barrido se llevaria los recibos que si estan en uso.
import { describe, it, expect } from 'vitest';
import { referencedPaths } from '../api/backup.js';

describe('referencedPaths (que NO se puede barrer)', () => {
  it('cuenta el campo nuevo', () => {
    const s = referencedPaths([{ transactions: [{ receiptPath: 'receipts/u1/a.jpg' }] }]);
    expect(s.has('receipts/u1/a.jpg')).toBe(true);
  });

  it('y saca el pathname de la URL publica vieja', () => {
    const s = referencedPaths([{ transactions: [{ receiptUrl: 'https://tienda.public.blob.vercel-storage.com/receipts/1757-receipt.jpg' }] }]);
    expect(s.has('receipts/1757-receipt.jpg')).toBe(true);
  });

  it('desescapa el pathname (un nombre con espacios no se salva solo)', () => {
    const s = referencedPaths([{ transactions: [{ receiptUrl: 'https://x/receipts/mi%20recibo.jpg' }] }]);
    expect(s.has('receipts/mi recibo.jpg')).toBe(true);
  });

  it('mira los docs de TODOS los usuarios, no uno', () => {
    const s = referencedPaths([
      { transactions: [{ receiptPath: 'receipts/u1/a.jpg' }] },
      { transactions: [{ receiptPath: 'receipts/u2/b.jpg' }] },
    ]);
    expect(s.has('receipts/u1/a.jpg')).toBe(true);
    expect(s.has('receipts/u2/b.jpg')).toBe(true);
  });

  it('una URL rota no rompe el barrido entero', () => {
    const s = referencedPaths([{ transactions: [{ receiptUrl: 'no-es-una-url' }, { receiptPath: 'receipts/u1/ok.jpg' }] }]);
    expect(s.has('receipts/u1/ok.jpg')).toBe(true);
  });

  it('un doc sin transacciones no aporta nada', () => {
    expect(referencedPaths([{}, null, { transactions: null }]).size).toBe(0);
  });
});
