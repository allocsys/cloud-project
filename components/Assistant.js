'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';
import { useT } from '@/components/I18nProvider';

// Ask Vertexhash: a floating button that opens a chat sheet. Answers come from POST /api/assistant, which only
// reads the signed-in user's own data. Nothing is stored here: the conversation lives in memory and is gone when
// the page closes. The button stays hidden until GET /api/assistant says the feature is switched on.

// [text key, the English question that is sent]. The assistant still matches questions in English, so the chip shows the translated label but sends the English text.
const CHIPS = [
  ['ast.c1', 'How long does a withdrawal take?'],
  ['ast.c2', 'How are earnings calculated?'],
  ['ast.c3', 'Are returns guaranteed?'],
];
const MAX = 500;
const LOW = 5; // show how many AI answers are left once it gets this low

const NOTES = {
  llm: 'ast.nLlm',
  'faq-guess': 'ast.nGuess',
  support: 'ast.nSupport',
};

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

// The assistant's mark: one big sparkle and two small ones. They breathe and twinkle (see .ai-mark in globals.css), and
// the big one spins while an answer is on its way.
const AiMark = ({ busy }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={`ai-mark${busy ? ' busy' : ''}`}>
    <path className="s1" d="M11 4c.7 4.6 3 6.9 7.6 7.6-4.6.7-6.9 3-7.6 7.6-.7-4.6-3-6.9-7.6-7.6C8 10.9 10.3 8.6 11 4z" />
    <path className="s2" d="M19 1.6c.3 2 1.1 2.8 3.1 3.1-2 .3-2.8 1.1-3.1 3.1-.3-2-1.1-2.8-3.1-3.1 2-.3 2.8-1.1 3.1-3.1z" />
    <path className="s3" d="M19 15.6c.25 1.7 1 2.45 2.7 2.7-1.7.25-2.45 1-2.7 2.7-.25-1.7-1-2.45-2.7-2.7 1.7-.25 2.45-1 2.7-2.7z" />
  </svg>
);

export default function Assistant() {
  const t = useT();
  const [info, setInfo] = useState(null); // { enabled, llm, left }
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const cardRef = useRef(null);
  const inputRef = useRef(null);
  const gen = useRef(0); // bumped by New chat, so an answer still on its way is dropped instead of landing in the new chat

  useEffect(() => {
    let live = true;
    fetch('/api/assistant', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && j?.enabled && setInfo(j))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    cardRef.current?.focus();
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  const send = useCallback(
    async (raw, shown) => {
      const q = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
      if (!q || busy) return;
      const g = gen.current;
      setText('');
      setBusy(true);
      setMsgs((m) => [...m, { role: 'me', text: shown || q }]);
      try {
        const r = await post('/api/assistant', { question: q });
        if (typeof r.left === 'number') setInfo((i) => (i ? { ...i, left: r.left } : i));
        if (g !== gen.current) return;
        setMsgs((m) => [...m, { role: 'bot', text: r.text, source: r.source, did: r.did }]);
      } catch (e) {
        if (g !== gen.current) return;
        const msg = e?.status === 401 ? t('ast.signIn') : t('ast.wrong');
        setMsgs((m) => [...m, { role: 'bot', text: msg, source: 'error' }]);
      } finally {
        if (g === gen.current) setBusy(false);
      }
    },
    [busy, t]
  );

  const newChat = () => {
    triggerHaptic('selection');
    gen.current += 1;
    setMsgs([]);
    setText('');
    setBusy(false);
    inputRef.current?.focus();
  };

  if (!info) return null;

  const leftNote =
    info.llm && typeof info.left === 'number' && info.left <= LOW
      ? info.left > 0
        ? t(info.left === 1 ? 'ast.left1' : 'ast.leftN', { n: info.left })
        : t('ast.limit')
      : null;

  return (
    <>
      <button
        type="button"
        className="asst-fab"
        aria-label={t('ast.ask')}
        title={t('ast.ask')}
        onClick={() => {
          triggerHaptic('selection');
          setOpen(true);
        }}
      >
        <AiMark busy={busy && open} />
      </button>

      {open && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asst-t"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="card asst" ref={cardRef} tabIndex={-1}>
            <div className="grab" aria-hidden="true" />
            <div className="asst-head">
              <div>
                <h3 id="asst-t" className="asst-title">
                  <AiMark busy={busy} />
                  {t('ast.ask')}
                </h3>
                <p className="asst-sub">{t('ast.sub')}</p>
              </div>
              <div className="asst-actions">
                {msgs.length > 0 && (
                  <button type="button" className="asst-new" onClick={newChat}>
                    <Icon d="M12 5v14M5 12h14" />
                    {t('ast.new')}
                  </button>
                )}
                <button type="button" className="asst-x" aria-label={t('common.close')} onClick={() => setOpen(false)}>
                  <Icon d="M6 6l12 12M18 6L6 18" />
                </button>
              </div>
            </div>

            <div className="asst-log" ref={logRef} aria-live="polite">
              {msgs.length === 0 && (
                <>
                  <p className="asst-empty">{t('ast.empty')}</p>
                  <div className="asst-chips">
                    {CHIPS.map(([k, q]) => (
                      <button key={k} type="button" onClick={() => send(q, t(k))}>
                        {t(k)}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`asst-m ${m.role}`}>
                  <p>{m.text}</p>
                  {m.role === 'bot' && NOTES[m.source] && <small className="asst-note">{t(NOTES[m.source])}</small>}
                  {m.role === 'bot' && m.did?.q && (
                    <button type="button" className="asst-did" disabled={busy} onClick={() => send(m.did.q)}>
                      {t('ast.did', { q: m.did.label || m.did.q })}
                    </button>
                  )}
                </div>
              ))}
              {busy && <small className="asst-note">{t('ast.thinking')}</small>}
            </div>

            {leftNote && <p className="asst-left">{leftNote}</p>}
            <form
              className="asst-form"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <input
                ref={inputRef}
                type="text"
                value={text}
                maxLength={MAX}
                placeholder={t('ast.placeholder')}
                aria-label={t('ast.yourQ')}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="asst-send" aria-label={t('ast.send')} disabled={busy || !text.trim()}>
                <Icon d="M4 12l16-8-6 16-3-7z" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
