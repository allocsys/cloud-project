import { ImageResponse } from 'next/og';
import { translate } from '@/lib/i18n/langs';

export const alt = 'Miner Opus';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The picture that shows when a link to the app is shared (Telegram, WhatsApp, X). The words are the existing English
// share title (meta.og.title); the built-in font has no Persian, so the picture is English for every language.
export default function Image() {
  const [brand, line] = translate('en', 'meta.og.title').split(': ');
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 90px',
          background: '#12110d',
          color: '#f3ead2',
        }}
      >
        <div style={{ display: 'flex', fontSize: 120, fontWeight: 700, color: '#e9c46a' }}>{brand}</div>
        {line ? <div style={{ display: 'flex', fontSize: 52, marginTop: 24 }}>{line}</div> : null}
      </div>
    ),
    size,
  );
}
