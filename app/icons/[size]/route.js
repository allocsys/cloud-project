import { ImageResponse } from 'next/og';

// App icons drawn at build time, so there are no binary files in the repo.
// "maskable" keeps the mark inside the centre safe zone for Android's round and squircle masks.
const SIZES = { 192: 192, 512: 512, maskable: 512, apple: 180 };

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req, { params }) {
  const { size } = await params;
  const px = SIZES[size];
  const glyph = size === 'maskable' ? px * 0.46 : px * 0.62;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#e9c46a',
          color: '#3b2a00',
          fontSize: glyph,
          fontWeight: 700,
        }}
      >
        O
      </div>
    ),
    { width: px, height: px }
  );
}
