import Nav from '@/components/Nav';
import BackGuard from '@/components/BackGuard';
import Assistant from '@/components/Assistant';

export default function AppLayout({ children }) {
  return (
    <div id="app">
      <Nav />
      <main>{children}</main>
      <BackGuard />
      <Assistant />
    </div>
  );
}
