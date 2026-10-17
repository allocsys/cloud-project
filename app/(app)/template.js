// A template remounts on every navigation, so the page entrance animation replays per route.
export default function Template({ children }) {
  return <div className="page">{children}</div>;
}
