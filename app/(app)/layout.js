import Nav from '@/components/Nav';

export default function AppLayout({ children }) {
  return (
    <div id="app">
      <Nav />
      <main>{children}</main>
    </div>
  );
}
