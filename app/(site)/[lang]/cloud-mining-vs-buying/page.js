import GuidePage, { guideMeta } from '@/components/GuidePage';
import { staticLangParams } from '@/lib/i18n/server';

export function generateStaticParams() {
  return staticLangParams();
}

export async function generateMetadata({ params }) {
  return guideMeta('vs', params);
}

export default function Page({ params }) {
  return <GuidePage id="vs" params={params} />;
}
