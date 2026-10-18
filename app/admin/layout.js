import './admin.css';

export const metadata = {
  title: 'Opus Admin',
  robots: { index: false, follow: false },
};

// Admin sits outside the app shell: no bottom navigation, never indexed.
export default function AdminLayout({ children }) {
  return (
    <div id="app">
      <main>{children}</main>
    </div>
  );
}
