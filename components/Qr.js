'use client';
// A QR code drawn as one SVG path (see lib/qr.js). Shared by the pay screen and Connect wallet.
import { useMemo } from 'react';
import { qrMatrix, qrPath } from '@/lib/qr';
import { useT } from '@/components/I18nProvider';

export function Qr({ value }) {
  const t = useT();
  const qr = useMemo(() => {
    try {
      const m = qrMatrix(value);
      return { size: m.length, d: qrPath(m) };
    } catch {
      return null;
    }
  }, [value]);
  if (!qr) return null;
  const pad = 3;
  const box = qr.size + pad * 2;
  return (
    <div style={{ width: 144, height: 144, margin: '10px 0 0' }}>
      <svg viewBox={`${-pad} ${-pad} ${box} ${box}`} width="144" height="144" role="img" aria-label={t('wal.qr')} shapeRendering="crispEdges">
        <rect x={-pad} y={-pad} width={box} height={box} fill="#fff" />
        <path d={qr.d} fill="#0b0a08" />
      </svg>
    </div>
  );
}
