// Ask Miner Opus: the server side of one question. Loads only the signed-in user's own data, builds the snapshot
// (lib/assistant-context.js), then lets lib/assistant.js choose FAQ, LLM or "contact support".
// Read-only: nothing here writes to the database. The question text is never logged or stored.
import { getUser } from '@/lib/server/db';
import { getWallet } from '@/lib/server/wallet';
import { getCatalog } from '@/lib/server/miners';
import { getPrices } from '@/lib/server/prices';
import { getMarket } from '@/lib/server/market';
import { telemetryFor } from '@/lib/server/telemetry';
import { makeLlm } from '@/lib/server/assistant-llm';
import { buildEarnings } from '@/lib/earnings';
import { buildSnapshot, faqCtx } from '@/lib/assistant-context';
import { answerQuestion } from '@/lib/assistant';
import { answersLeft } from '@/lib/assistant-limits';

// -> { source: 'faq' | 'llm' | 'faq-guess' | 'support', text, did, left }
// left = how many LLM answers the user still has today (FAQ answers are free and never counted).
export async function ask(userId, question, deps = {}) {
  const d = { getUser, getWallet, getCatalog, getPrices, getMarket, getTelemetry: telemetryFor, makeLlm, answersLeft, now: Date.now, ...deps };
  const now = d.now();
  const [u, wallet, snap, market] = await Promise.all([d.getUser(userId), d.getWallet(userId), d.getPrices(), d.getMarket()]);
  const telemetry = await d.getTelemetry(u.contracts, now);
  const snapshot = buildSnapshot({
    contracts: u.contracts,
    earnings: buildEarnings(u.contracts, now, undefined, market, telemetry),
    wallet,
    history: wallet.history,
    plans: d.getCatalog().plans,
    btcUsd: snap?.prices?.btc,
    now,
  });
  const r = await answerQuestion(question, { ctx: faqCtx(snapshot), llm: d.makeLlm(userId, snapshot) });
  return { source: r.source, text: r.text, did: r.did, left: d.answersLeft(userId) };
}
