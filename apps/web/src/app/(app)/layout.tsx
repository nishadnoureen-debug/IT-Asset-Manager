import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { Spinner } from '@/components/ui/states';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </AppShell>
  );
}
