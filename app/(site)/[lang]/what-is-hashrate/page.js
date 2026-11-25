import GuidePage, { guideMeta } from '@/components/GuidePage';
import { staticLangParams } from '@/lib/i18n/server';

export function generateStaticParams() {
  return staticLangParams();
}

export async function generateMetadata({ params }) {
  return guideMeta('hash', params);
}

export default function Page({ params }) {
  return <GuidePage id="hash" params={params} />;
}
