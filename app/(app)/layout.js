import Nav from '@/components/Nav';
import BackGuard from '@/components/BackGuard';

export default function AppLayout({ children }) {
  return (
    <div id="app">
      <Nav />
      <main>{children}</main>
      <BackGuard />
    </div>
  );
}
