import Nav from '@/components/Nav';
import BackGuard from '@/components/BackGuard';
import Assistant from '@/components/Assistant';
import WalletProvider from '@/components/WalletProvider';
import { PendingStrip } from '@/components/PendingOrders';

export default function AppLayout({ children }) {
  return (
    <div id="app">
      <WalletProvider>
        <Nav />
        <main>
          <PendingStrip />
          {children}
        </main>
        <BackGuard />
        <Assistant />
      </WalletProvider>
    </div>
  );
}
