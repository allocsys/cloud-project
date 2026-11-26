// Shown at once when a signed-in page is opened, while the server prepares the next one. The bar and menu stay;
// the page area stays empty. Each page draws its own loading look with its saved copy (lib/placeholder.js, .ld),
// so generic blocks here would only be replaced by a different shape (a small jump).
export default function Loading() {
  return <div className="grid" aria-busy="true" />;
}
