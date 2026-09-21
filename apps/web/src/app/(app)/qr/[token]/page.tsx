'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/states';

/** Target of printed QR labels: hands the token to the scan page (after sign-in if needed). */
export default function QrLinkPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/scan?code=${encodeURIComponent(token)}`);
  }, [router, token]);
  return <Spinner label="Opening asset" />;
}
