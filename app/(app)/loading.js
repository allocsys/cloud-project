// Shown at once when a signed-in page is opened, while the server prepares the next one. The bar and menu stay;
// only the page area shows soft blocks (.sk, app/globals.css). Screens with their own loading.js (Earnings, Wallet, Plans, Invite,
// Miner, Settings and its Security / Notifications) show their real loading look instead; this one is for the rest.
export default function Loading() {
  return (
    <div className="grid" aria-busy="true">
      <span className="sk" style={{ height: 28, width: '40%' }} />
      <div className="card">
        <span className="sk" style={{ height: 14, width: '30%', marginBottom: 12 }} />
        <span className="sk" style={{ height: 34, width: '60%' }} />
      </div>
      <div className="card">
        <span className="sk" style={{ height: 14, width: '50%', marginBottom: 12 }} />
        <span className="sk" style={{ height: 14, width: '80%', marginBottom: 10 }} />
        <span className="sk" style={{ height: 14, width: '70%' }} />
      </div>
    </div>
  );
}
