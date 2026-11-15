// Farm videos: only links from Google Drive, YouTube and Vimeo are accepted, and only a strictly shaped id reaches the player address.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideo, cleanVideo, TITLE_MAX } from '../lib/farm.js';

test('YouTube links of every common shape give the same player', () => {
  const want = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1';
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://m.youtube.com/embed/dQw4w9WgXcQ']) {
    const p = parseVideo(u);
    assert.equal(p.kind, 'youtube');
    assert.equal(p.embed, want);
  }
  assert.equal(parseVideo('https://youtu.be/dQw4w9WgXcQ').thumb, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
});

test('Vimeo links, with and without the unlisted hash', () => {
  assert.equal(parseVideo('https://vimeo.com/123456789').embed, 'https://player.vimeo.com/video/123456789?playsinline=1');
  assert.equal(parseVideo('https://vimeo.com/123456789/abcdef1234').embed, 'https://player.vimeo.com/video/123456789?h=abcdef1234&playsinline=1');
  assert.equal(parseVideo('https://player.vimeo.com/video/123456789?h=abcdef1234').embed, 'https://player.vimeo.com/video/123456789?h=abcdef1234&playsinline=1');
  assert.equal(parseVideo('https://vimeo.com/channels/staffpicks/123456789'), null);
});

test('Google Drive share links give the preview player', () => {
  const want = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/preview';
  assert.equal(parseVideo('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing').embed, want);
  assert.equal(parseVideo('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv').embed, want);
  assert.equal(parseVideo('https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOpQrStUv&export=download').embed, want);
  assert.equal(parseVideo('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view').thumb, '');
});

test('anything else is refused', () => {
  for (const u of ['', 'not a link', 'http://youtu.be/dQw4w9WgXcQ', 'javascript:alert(1)', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com/watch?v=short', 'https://youtube.com/watch?v=dQw4w9WgXcQ"onload=1', 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv', 'https://drive.google.com/file/d/x/view', 'https://vimeo.com/abc']) {
    assert.equal(parseVideo(u), null, u);
  }
});

test('a good video is accepted, a bad one explained', () => {
  const v = cleanVideo({ title: '  Hall   one  ', url: 'https://youtu.be/dQw4w9WgXcQ' });
  assert.equal(v.video.title, 'Hall one');
  assert.equal(v.video.kind, 'youtube');
  assert.ok(cleanVideo({ title: '', url: 'https://youtu.be/dQw4w9WgXcQ' }).error);
  assert.ok(cleanVideo({ title: 'x', url: 'https://example.com/v' }).error);
  assert.ok(cleanVideo({ title: 'a'.repeat(TITLE_MAX + 1), url: 'https://youtu.be/dQw4w9WgXcQ' }).error);
  assert.equal(cleanVideo({ title: 'a'.repeat(TITLE_MAX), url: 'https://youtu.be/dQw4w9WgXcQ' }).video.title.length, TITLE_MAX);
});
