import { PageHeader } from '@/components/ui';
import { ReleaseList } from './ReleaseList';

/**
 * "What's new" — the in-app release notes. Signed-in only (a normal internal
 * route inside the app shell). The list itself is a client component: it reads
 * which releases this browser has already seen, which only the browser knows.
 */
export const metadata = { title: 'What’s new · FormPing' };

export default function WhatsNewPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-8">
      <PageHeader title="What’s new" description="The latest updates and improvements to FormPing." />
      <ReleaseList />
    </main>
  );
}
