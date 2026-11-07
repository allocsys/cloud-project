import '../admin/admin.css';

export const metadata = {
  title: 'Vertexhash Review',
  robots: { index: false, follow: false },
};

// Like Admin: outside the app shell, no bottom navigation, never indexed.
export default function ReviewLayout({ children }) {
  return (
    <div id="app">
      <main>{children}</main>
    </div>
  );
}
