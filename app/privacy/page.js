import Link from 'next/link';

const h2 = { fontSize: '16px', margin: '22px 0 6px' };

export const metadata = { title: 'Privacy Policy' };

// Written from what the app really does today. If the app starts keeping ID photos, adds analytics or another
// provider, change this page in the same commit.
export default function Privacy() {
  return (
    <section id="auth">
      <div className="authbox" style={{ textAlign: 'left', maxWidth: '560px' }}>
        <h1>Privacy Policy</h1>
        <p className="mute">What we collect, why, and who else handles it.</p>

        <h2 style={h2}>1. What we collect</h2>
        <p className="mute"><b>Account.</b> Your email address and a scrambled (hashed) form of your password; we never keep the password itself. If you sign in with Telegram, your Telegram ID and name.</p>
        <p className="mute"><b>Identity check.</b> If you verify your identity: your name, date of birth, country and document type. The photos you send are checked and not kept; we record only their size and type.</p>
        <p className="mute"><b>Activity.</b> Your plans, balance, earnings, deposits, withdrawals (including the addresses you withdraw to), invites and settings.</p>
        <p className="mute"><b>Security.</b> Your sign-in sessions, your two-factor key if you turn it on, and your IP address, which is used to slow down repeated sign-in attempts.</p>
        <p className="mute"><b>Assistant.</b> We do not save the questions you ask. When the assistant uses an AI model to answer, your question and a short summary of your own account figures are sent to the AI provider.</p>

        <h2 style={h2}>2. How we use it</h2>
        <p className="mute">To run your account, plans and payouts; to send you emails such as verification and password reset; to check identity and prevent fraud; to keep the service secure; and to answer your questions. We do not sell your data.</p>

        <h2 style={h2}>3. Who else handles it</h2>
        <p className="mute">Our hosting and database provider (Railway) stores the data. Our email provider (Resend) delivers emails. The AI provider, as described above, sees assistant questions. If you use Telegram, Telegram handles that part under its own policy.</p>
        <p className="mute">Crypto deposits and withdrawals happen on public blockchains, so the addresses and amounts involved can be seen by anyone there. We cannot remove them.</p>

        <h2 style={h2}>4. How long we keep it</h2>
        <p className="mute">While your account is open, and afterwards for as long as the law requires us to keep financial records. You can ask us to delete your account and the data we are not required to keep.</p>

        <h2 style={h2}>5. Your choices</h2>
        <p className="mute">You can change your alert settings, turn on two-factor sign-in, and change your password in Settings. To get a copy of your data or have it deleted, contact support through the app.</p>

        <h2 style={h2}>6. Security</h2>
        <p className="mute">Passwords are stored hashed, sign-in can be protected with two-factor codes, and repeated wrong attempts are slowed down. No system is perfectly safe, so use a strong, unique password.</p>

        <h2 style={h2}>7. Age and changes</h2>
        <p className="mute">The service is for people aged 18 or older. If we change this policy, we tell you before the change takes effect.</p>

        <div style={{ height: '14px' }} />
        <Link className="btn" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Back</Link>
      </div>
    </section>
  );
}
