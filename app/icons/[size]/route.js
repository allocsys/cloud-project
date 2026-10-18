import { ImageResponse } from 'next/og';
import { logoSvg } from '@/lib/logo';

// App icons drawn at build time from the shared logo mark, so there are no binary files in the repo.
// "maskable" shrinks the mark into Android's centre safe zone for round and squircle masks.
const SIZES = { 192: 192, 512: 512, maskable: 512, apple: 180 };

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req, { params }) {
  const { size } = await params;
  const px = SIZES[size];
  const svg = logoSvg({ scale: size === 'maskable' ? 0.72 : 0.92 });
  const src = `data:image/svg+xml,${encodeURIComponent(svg)}`;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex' }}>
        <img src={src} width={px} height={px} alt="" />
      </div>
    ),
    { width: px, height: px }
  );
}
