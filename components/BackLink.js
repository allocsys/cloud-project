'use client';
import { useRouter } from 'next/navigation';

// The Back button at the bottom of the Terms and Privacy pages: step back to where the person came from
// (the page, or the sign-in sheet's page), or to the home page when the page was opened directly.
export default function BackLink() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.replace('/');
      }}
    >
      Back
    </button>
  );
}
