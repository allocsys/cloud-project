'use client';
import dynamic from 'next/dynamic';

// The assistant button stays hidden until GET /api/assistant says the feature is on, so it can
// load after hydration instead of riding in first load on every signed-in page.
const Assistant = dynamic(() => import('@/components/Assistant'), { ssr: false });

export default function AssistantLazy() {
  return <Assistant />;
}
