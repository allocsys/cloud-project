'use client';
// One farm video. It shows a picture box with a play button and loads the provider's player only after a tap,
// so the landing page stays light and nothing from Google or Vimeo loads before the visitor asks for it.
import { useState } from 'react';

export default function FarmVideo({ v, label }) {
  const [on, setOn] = useState(false);
  // YouTube and Vimeo can start at once after the tap; a Drive preview cannot, so the visitor taps play inside it.
  const src = on && v.kind !== 'drive' ? `${v.embed}&autoplay=1` : v.embed;
  return (
    <div className="fm-box">
      {on ? (
        <iframe
          className="fm-frame"
          src={src}
          title={v.title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : (
        <button type="button" className="fm-play" aria-label={label} onClick={() => setOn(true)}>
          {v.thumb && <img src={v.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
          <span className="fm-dot">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
