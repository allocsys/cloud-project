// Server errors arrive in English. The browser looks the text up here and shows the language's own version.
// Admin messages are left out on purpose (the admin area stays English). Texts with numbers use PATTERNS.
// No match, or no translation for the language: the English message is shown unchanged.
import { translate } from '@/lib/i18n/langs';

const EXACT = {
  'Something went wrong.': 'set.wrong',
  'Invalid request.': 'err.invalid',
  'Too many attempts. Try again in 15 minutes.': 'err.tooMany',
  'Unknown action.': 'err.unknownAction',
  'Sign in required.': 'err.signInReq',
  'Account not found.': 'err.noAccount',
  'Nothing to save.': 'err.nothingSave',
  'Miner not found.': 'min.notFound',

  'Code not found.': 'err.codeNotFound',
  'Invite code not found.': 'err.inviteNotFound',
  'Already linked to an inviter.': 'err.alreadyLinked',
  'This invite code has reached its limit.': 'err.codeLimit',
  'Buy a plan to manage your own codes.': 'err.buyToManage',
  'A rebate can only be raised, not lowered.': 'err.rebateRaise',
  'Give the code a name.': 'err.codeName',
  'This code has friends, so it cannot be removed.': 'err.codeFriends',
  'You already have a code with this name.': 'err.codeDup',

  'This link is invalid or has expired.': 'err.linkBad',
  'This link is invalid, expired or already used.': 'err.linkBad2',
  'This reset link is invalid or has expired. Request a new one.': 'err.resetBad',
  'Telegram sign-in could not be verified.': 'err.tgVerify',
  'Telegram sign-in expired. Close and reopen the app, then try again.': 'err.tgExpired',
  'Wrong email or password.': 'err.wrongLogin',
  'Only Telegram accounts can add an email.': 'err.onlyTg',
  'Sign in to your own account first.': 'err.ownFirst',
  'This account has no email address.': 'err.noEmail',
  'This account has no password to change.': 'err.noPw',
  'Two-factor works with email and password accounts. This account signs in another way.': 'err.tfWrongKind',
  'An account with this email already exists. Sign in instead.': 'err.emailExists',
  'The code expired. Ask for a new one.': 'err.codeExpired',
  'The setup key expired. Start again.': 'err.keyExpired',
  'This account already has an email.': 'err.hasEmail',
  'This email is already in use.': 'err.emailUsed',
  'Two-factor is already on.': 'err.tfOn',
  'Two-factor is not on.': 'err.tfOff',
  'Your password changed while you were doing this. Try again.': 'err.pwChanged',
  'Choose a different password.': 'err.pwDifferent',
  'Current password is wrong.': 'err.curWrong',
  'Enter a valid email address.': 'auth.errEmail',
  'Enter the 6-digit code from the email.': 'err.emailCode',
  'New password needs at least 8 characters.': 'set.eNewPw',
  'Password is wrong.': 'err.pwWrong',
  'Password needs at least 8 characters.': 'auth.errPassword',
  'That code is not right. Check the app and try the next one.': 'err.codeBad2',
  'That code is not right.': 'err.codeBad',
  'Type DELETE to confirm.': 'set.eDel',
  'A code was just sent. Wait a minute before asking again.': 'err.sentCode',
  'A link was just sent. Wait a minute before asking again.': 'err.sentLink',
  'Too many wrong codes. Ask for a new one.': 'err.manyCodes',
  'Could not send the email. Try again later.': 'err.mailFail',
  'Email is not set up yet.': 'err.mailOff',
  'Password reset by email is not set up yet.': 'err.resetOff',
  'Telegram sign-in is not set up yet.': 'err.tgOff',

  'Verification was already submitted.': 'err.kycDone',
  'Choose a document type.': 'err.kycDoc',
  'Choose your country.': 'kyc.eCountry',
  'Enter your date of birth.': 'kyc.eDob',
  'Enter your first and last name.': 'kyc.eName',
  'Photo is too large (max 12 MB).': 'kyc.eBig',
  'Photos must be images.': 'err.kycPhotos',
  'You must be 18 or older.': 'kyc.eAge',

  // Money, orders, Smart Mining and boost. Persian for these needs approval, so some keys are in en.js only for now.
  'Unknown coin or network.': 'err.coinNet',
  'Enter an amount to withdraw.': 'wal.errAmount',
  'Enter an amount to deposit.': 'err.depAmount',
  'More than your available balance.': 'wal.errMore',
  'Too small to cover the fees.': 'wal.errSmall',
  'Not enough balance for this plan.': 'err.balPlan',
  'Not enough balance for this ticket.': 'err.balTicket',
  'Boost tickets are not available right now.': 'err.ticketsOff',
  'No BTC price is available right now. Try again in a moment.': 'err.noBtc',
  'Unknown ticket.': 'err.ticketUnknown',
  'Smart Mining is not available right now.': 'err.smartOff',
  'Only Smart Mining miners can renew.': 'err.smartOnly',
  'Nothing to renew.': 'err.nothingRenew',
  'This term has ended.': 'err.termEnded',
  'This term has not ended yet.': 'err.termNot',
  'You have unpaid orders. Pay or cancel one first.': 'err.unpaid',
  'This order is no longer open.': 'err.orderClosed',
  'This payment is still being set up. Try again in a moment.': 'err.payPrep',
  'Could not start the payment. Try again in a moment.': 'err.payStart',
  'Crypto payments are not switched on yet.': 'err.cryptoOff',
  'Already paid.': 'err.paid',
  'Order not found.': 'err.orderNone',
  'Unknown order.': 'err.orderUnknown',
  'Choose how to pay.': 'err.howPay',
  'Invalid size or term.': 'err.sizeTerm',
};

// [pattern, key, how the numbers or names in the text become {placeholders}]
const PATTERNS = [
  [/^Rebate must be a whole number from 0 to (\d+)\.$/, 'err.rebateWhole', (m) => ({ n: m[1] })],
  [/^You can have up to (\d+) codes\.$/, 'err.maxCodes', (m) => ({ n: m[1] })],
  [/^Enter a valid (.+) address\.$/, 'wal.errAddr', (m) => ({ net: m[1] })],
  [/^Below the minimum of \$(.+)\.$/, 'err.wdMin', (m) => ({ n: m[1] })],
  [/^You can have up to (\d+) of this boost running at once\.$/, 'err.boostMax', (m) => ({ n: m[1] })],
  [/^Without a plan, deposits can be withdrawn after (\d+) days\.$/, 'wal.errHold', (m) => ({ days: m[1] })],
];

// message: the English text from the server. Returns the text to show.
export function translateError(lang, message) {
  const msg = typeof message === 'string' && message ? message : 'Something went wrong.';
  if (!lang || lang === 'en') return msg;
  let key = EXACT[msg];
  let vars;
  if (!key) {
    for (const [re, k, vf] of PATTERNS) {
      const m = re.exec(msg);
      if (m) {
        key = k;
        vars = vf(m);
        break;
      }
    }
  }
  if (!key) return msg;
  const s = translate(lang, key, vars);
  return s === key ? msg : s;
}
