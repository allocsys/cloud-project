// Ask Vertexhash: answer routing. No network here: the LLM is passed in as a function.
// answerQuestion(question, { ctx, llm, timeoutMs }) -> { source, text, did }
//   source: 'faq' | 'llm' | 'faq-guess' | 'support'
// Flow: FAQ high confidence answers directly. Otherwise ask the LLM (if given).
// If the LLM is missing, down, slow, rate limited or returns something unsafe:
// a medium FAQ match becomes a labelled best guess, anything else points to support.
// llm(question, match, ctx) returns a string, or null/'' when unavailable (limit reached).

export const MAX_QUESTION = 500;
export const LLM_TIMEOUT_MS = 15000;

export const SUPPORT_TEXT = 'I am not sure about that one. Please contact support from the Help section and a person will look at it.';
export const EMPTY_TEXT = 'Ask me a question about your plans, earnings, deposits or withdrawals.';

// Replies we never pass on: return promises and AI-washing claims.
const UNSAFE = /guaranteed (profit|return|income|earning)s?|risk[- ]free|double your|ai[- ](boost|optimi[sz]|power(ed)? (return|mining|profit))|will (earn|make) you/i;

import { matchFaq, faqVars } from './faq.js';

function clean(q) {
  return String(q == null ? '' : q).replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function askLlm(llm, question, match, ctx, timeoutMs) {
  if (typeof llm !== 'function') return null;
  try {
    const out = await withTimeout(Promise.resolve(llm(question, match, ctx)), timeoutMs);
    const text = typeof out === 'string' ? out.trim() : '';
    if (!text || UNSAFE.test(text)) return null;
    return text;
  } catch {
    return null;
  }
}

export async function answerQuestion(question, opts = {}) {
  // tr(key, vars) gives the text in the person's language, or null to keep the English one (null for English).
  const { ctx = {}, llm = null, timeoutMs = LLM_TIMEOUT_MS, tr = null } = opts;
  const q = clean(question);
  if (!q) return { source: 'support', text: (tr && tr('_empty')) || EMPTY_TEXT, did: null };

  const match = matchFaq(q, ctx);
  // faqVars may name a variant (alt: 'a2') and carry a withdrawal status (st) that has its own translation (wst.<status>).
  const said = (id, en) => {
    if (!tr) return en;
    const v = faqVars(id, ctx);
    let vars = v;
    if (v && v.st) {
      const st = tr(`wst.${v.st}`);
      if (!st) return en;
      vars = { ...v, st };
    }
    return tr(`${id}.${(v && v.alt) || 'a'}`, vars) || en;
  };
  if (match.level === 'high') return { source: 'faq', text: said(match.id, match.answer), did: null };

  const text = await askLlm(llm, q, match, ctx, timeoutMs);
  if (text) return { source: 'llm', text, did: null };

  if (match.level === 'medium') {
    // did.q stays English because it is what is sent back as the question; did.label is what the person reads.
    const did = match.did && tr ? { ...match.did, label: tr(`${match.did.id}.q`) || match.did.q } : match.did;
    return { source: 'faq-guess', text: said(match.id, match.answer), did };
  }
  return { source: 'support', text: (tr && tr('_support')) || SUPPORT_TEXT, did: null };
}
