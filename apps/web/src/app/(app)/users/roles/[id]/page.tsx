'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { Permission, Role } from '@/lib/types';

const MODULE_LABELS: Record<string, string> = {
  activity_log: 'Activity log',
  asset_type: 'Asset types',
};

function moduleLabel(m: string) {
  return MODULE_LABELS[m] ?? m.charAt(0).toUpperCase() + m.slice(1);
}

function action(key: string) {
  return key.split('.').slice(1).join('.').replace(/_/g, ' ');
}

export default function RolePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const toast = useToast();
  const role = useApi<Role>(`/roles/${id}`, undefined, { placeholderData: undefined });
  const permissions = useApi<Permission[]>('/permissions');
  const save = useApiMutation<Record<string, unknown>>('put', `/roles/${id}/permissions`, [
    '/roles',
  ]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (role.data) setSelected(new Set(role.data.data.permissionKeys ?? []));
  }, [role.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions.data?.data ?? [])
      map.set(p.module, [...(map.get(p.module) ?? []), p]);
    return [...map];
  }, [permissions.data]);

  return (
    <QueryState query={role}>
      {(r) => {
        const locked = r.name === 'SUPER_ADMIN' || !can('role.manage');
        const dirty = [...selected].sort().join() !== [...(r.permissionKeys ?? [])].sort().join();
        return (
          <>
            <PageHeader
              back={<BackLink href="/users?tab=roles">Roles</BackLink>}
              title={
                <span className="flex items-center gap-3">
                  {r.displayName}
                  {r.isSystem && <Badge tone="blue">System role</Badge>}
                </span>
              }
              description={`${r.description ?? ''} · ${r._count.users} user(s) · ${selected.size} permissions`}
              actions={
                !locked && (
                  <>
                    <Button
                      variant="secondary"
                      disabled={!dirty}
                      onClick={() => setSelected(new Set(r.permissionKeys ?? []))}
                    >
                      Reset
                    </Button>
                    <Button
                      disabled={!dirty}
                      loading={save.isPending}
                      onClick={async () => {
                        try {
                          await save.mutateAsync({ permissionKeys: [...selected] });
                          toast.success(
                            'Permissions saved — they apply to signed-in users within seconds',
                          );
                          void role.refetch();
                        } catch (e) {
                          toast.error(e);
                        }
                      }}
                    >
                      Save permissions
                    </Button>
                  </>
                )
              }
            />
            {r.name === 'SUPER_ADMIN' && (
              <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                Super Admin always has every permission and cannot be edited.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {grouped.map(([module, perms]) => {
                const all = perms.every((p) => selected.has(p.key));
                return (
                  <Card key={module}>
                    <CardHeader
                      title={moduleLabel(module)}
                      actions={
                        !locked && (
                          <button
                            type="button"
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            onClick={() =>
                              setSelected((s) => {
                                const next = new Set(s);
                                perms.forEach((p) => (all ? next.delete(p.key) : next.add(p.key)));
                                return next;
                              })
                            }
                          >
                            {all ? 'Clear' : 'Select all'}
                          </button>
                        )
                      }
                    />
                    <CardBody className="space-y-2">
                      {perms.map((p) => (
                        <label
                          key={p.key}
                          className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300"
                            disabled={locked}
                            checked={selected.has(p.key)}
                            onChange={(e) =>
                              setSelected((s) => {
                                const next = new Set(s);
                                if (e.target.checked) next.add(p.key);
                                else next.delete(p.key);
                                return next;
                              })
                            }
                          />
                          <span className="capitalize">{action(p.key)}</span>
                          <code className="ml-auto text-[11px] text-slate-400">{p.key}</code>
                        </label>
                      ))}
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          </>
        );
      }}
    </QueryState>
  );
}
