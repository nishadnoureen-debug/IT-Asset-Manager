'use client';

import clsx from 'clsx';
import { CheckCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Pagination } from '@/components/ui/data-table';
import { EmptyState, QueryState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { formatRelative, label } from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { NotificationItem } from '@/lib/types';

export default function NotificationsPage() {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<'unread' | 'all'>('unread');
  const [page, setPage] = useState(1);
  const query = useApi<NotificationItem[]>('/notifications', {
    unread: view === 'unread' || undefined,
    page,
    limit: 20,
  });
  const readAll = useApiMutation('post', '/notifications/read-all', ['/notifications']);

  const open = async (n: NotificationItem) => {
    if (!n.readAt) {
      await api.patch(`/notifications/${n.id}/read`).catch(() => undefined);
      void query.refetch();
    }
    if (n.link) router.push(n.link);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Warranty and licence expiry, overdue returns, maintenance and request updates."
        actions={
          <Button
            variant="secondary"
            loading={readAll.isPending}
            icon={<CheckCheck className="h-4 w-4" />}
            onClick={() =>
              readAll
                .mutateAsync({})
                .then(() => toast.success('All marked as read'))
                .catch((e) => toast.error(e))
            }
          >
            Mark all read
          </Button>
        }
      />
      <Card>
        <div className="px-4 pt-3">
          <Tabs
            value={view}
            onChange={(v) => {
              setView(v);
              setPage(1);
            }}
            tabs={[
              { value: 'unread', label: 'Unread' },
              { value: 'all', label: 'All' },
            ]}
          />
        </div>
        <QueryState query={query}>
          {(items) =>
            items.length ? (
              <>
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className="flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
                      >
                        <span
                          className={clsx(
                            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                            n.readAt ? 'bg-transparent' : 'bg-blue-500',
                          )}
                          aria-label={n.readAt ? undefined : 'Unread'}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={clsx(
                                'text-sm',
                                n.readAt
                                  ? 'text-slate-700 dark:text-slate-300'
                                  : 'font-semibold text-slate-900 dark:text-slate-100',
                              )}
                            >
                              {n.title}
                            </span>
                            <Badge>{label('notificationType', n.type)}</Badge>
                          </span>
                          <span className="block text-sm text-slate-600 dark:text-slate-400">
                            {n.message}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {formatRelative(n.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {query.data?.meta && <Pagination meta={query.data.meta} onPage={setPage} />}
              </>
            ) : (
              <EmptyState
                title={view === 'unread' ? "You're all caught up" : 'No notifications yet'}
              />
            )
          }
        </QueryState>
      </Card>
    </div>
  );
}
