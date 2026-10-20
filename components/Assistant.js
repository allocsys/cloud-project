'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { post } from '@/lib/api';
import { triggerHaptic } from '@/lib/haptics';

// Ask Miner Opus: a floating button that opens a chat sheet. Answers come from POST /api/assistant, which only
// reads the signed-in user's own data. Nothing is stored here: the conversation lives in memory and is gone when
// the page closes. The button stays hidden until GET /api/assistant says the feature is switched on.

const CHIPS = ['How long does a withdrawal take?', 'How are earnings calculated?', 'Are returns guaranteed?'];
const MAX = 500;
const LOW = 5; // show how many AI answers are left once it gets this low

const NOTES = {
  llm: 'AI-generated answer. Check important details before you act on them.',
  'faq-guess': 'Best guess from our help topics. If it does not fit, contact support.',
  support: 'I could not find an answer, so this one needs a person.',
};

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

export default function Assistant() {
  const [info, setInfo] = useState(null); // { enabled, llm, left }
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const cardRef = useRef(null);

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
    async (raw) => {
      const q = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
      if (!q || busy) return;
      setText('');
      setBusy(true);
      setMsgs((m) => [...m, { role: 'me', text: q }]);
      try {
        const r = await post('/api/assistant', { question: q });
        setMsgs((m) => [...m, { role: 'bot', text: r.text, source: r.source, did: r.did }]);
        if (typeof r.left === 'number') setInfo((i) => (i ? { ...i, left: r.left } : i));
      } catch (e) {
        const msg = e?.status === 401 ? 'Please sign in again to ask a question.' : 'Something went wrong. Please try again.';
        setMsgs((m) => [...m, { role: 'bot', text: msg, source: 'error' }]);
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  if (!info) return null;

  const leftNote =
    info.llm && typeof info.left === 'number' && info.left <= LOW
      ? info.left > 0
        ? `${info.left} AI answer${info.left === 1 ? '' : 's'} left today`
        : 'Daily AI limit reached. I can still answer common questions.'
      : null;

  return (
    <>
      <button
        type="button"
        className="asst-fab"
        aria-label="Ask Miner Opus"
        title="Ask Miner Opus"
        onClick={() => {
          triggerHaptic('selection');
          setOpen(true);
        }}
      >
        <Icon d="M4 5h16v11H9l-5 4zM8.5 10h7" />
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
                <h3 id="asst-t">Ask Miner Opus</h3>
                <p className="asst-sub">AI assistant, not financial advice</p>
              </div>
              <button type="button" className="asst-x" aria-label="Close" onClick={() => setOpen(false)}>
                <Icon d="M6 6l12 12M18 6L6 18" />
              </button>
            </div>

            <div className="asst-log" ref={logRef} aria-live="polite">
              {msgs.length === 0 && (
                <>
                  <p className="asst-empty">Ask about your plans, earnings, deposits or withdrawals.</p>
                  <div className="asst-chips">
                    {CHIPS.map((c) => (
                      <button key={c} type="button" onClick={() => send(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={`asst-m ${m.role}`}>
                  <p>{m.text}</p>
                  {m.role === 'bot' && NOTES[m.source] && <small className="asst-note">{NOTES[m.source]}</small>}
                  {m.role === 'bot' && m.did?.q && (
                    <button type="button" className="asst-did" disabled={busy} onClick={() => send(m.did.q)}>
                      Did you mean: {m.did.q}
                    </button>
                  )}
                </div>
              ))}
              {busy && <small className="asst-note">Thinking…</small>}
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
                type="text"
                value={text}
                maxLength={MAX}
                placeholder="Type your question"
                aria-label="Your question"
                autoComplete="off"
                enterKeyHint="send"
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="asst-send" aria-label="Send" disabled={busy || !text.trim()}>
                <Icon d="M4 12l16-8-6 16-3-7z" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
