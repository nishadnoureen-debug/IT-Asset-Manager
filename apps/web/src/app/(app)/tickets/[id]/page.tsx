'use client';

import { CheckCircle2, Lock, Send, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { BackLink } from '@/components/back-link';
import { Documents } from '@/components/documents';
import { StaffSelect } from '@/components/pickers';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, DetailList, PageHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { QueryState } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import {
  formatDateTime,
  formatRelative,
  fullName,
  label,
  maintenanceRef,
  ticketRef,
} from '@/lib/format';
import { useApi, useApiMutation } from '@/lib/hooks';
import type { Ticket } from '@/lib/types';

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, user } = useAuth();
  const toast = useToast();
  const query = useApi<Ticket>(`/tickets/${id}`, undefined, { placeholderData: undefined });
  const inv = ['/tickets'];
  const comment = useApiMutation<Record<string, unknown>>('post', `/tickets/${id}/comments`, inv);
  const update = useApiMutation<Record<string, unknown>>('patch', `/tickets/${id}`, inv);
  const assign = useApiMutation<Record<string, unknown>>('post', `/tickets/${id}/assign`, inv);
  const resolve = useApiMutation<Record<string, unknown>>('post', `/tickets/${id}/resolve`, inv);
  const close = useApiMutation('post', `/tickets/${id}/close`, inv);
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState('');

  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast.success(message);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <QueryState query={query}>
      {(t) => {
        const staff = can('ticket.edit');
        const closed = t.status === 'CLOSED';
        const isRequester = !!user?.employeeId && t.requester?.id === user.employeeId;
        const canClose =
          !closed && (can('ticket.close') || (isRequester && t.status === 'RESOLVED'));
        return (
          <>
            <PageHeader
              back={<BackLink href="/tickets">Helpdesk</BackLink>}
              title={t.title}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  {ticketRef(t.number)} <StatusBadge group="ticketStatus" value={t.status} />{' '}
                  <StatusBadge group="priority" value={t.priority} />
                </span>
              }
              actions={
                <>
                  {can('ticket.resolve') && !closed && t.status !== 'RESOLVED' && (
                    <Button
                      onClick={() => setResolving(true)}
                      icon={<CheckCircle2 className="h-4 w-4" />}
                    >
                      Resolve
                    </Button>
                  )}
                  {canClose && (
                    <Button
                      variant="secondary"
                      onClick={() => act(() => close.mutateAsync({}), 'Ticket closed')}
                      loading={close.isPending}
                      icon={<XCircle className="h-4 w-4" />}
                    >
                      Close
                    </Button>
                  )}
                </>
              }
            />
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                <Card>
                  <CardBody>
                    <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">
                      {t.description}
                    </p>
                    <p className="mt-3 text-xs text-slate-500">
                      Raised {formatDateTime(t.createdAt)}
                      {t.createdBy && ` by ${t.createdBy.displayName}`}
                    </p>
                  </CardBody>
                </Card>
                {t.resolution && (
                  <Card className="border-emerald-200 dark:border-emerald-900">
                    <CardHeader title="Resolution" description={formatDateTime(t.resolvedAt)} />
                    <CardBody className="whitespace-pre-wrap text-sm">{t.resolution}</CardBody>
                  </Card>
                )}
                <Card>
                  <CardHeader
                    title="Conversation"
                    description={`${t.comments?.length ?? 0} comments`}
                  />
                  <CardBody className="space-y-4">
                    {t.comments?.map((c) => (
                      <div
                        key={c.id}
                        className={`rounded-lg p-3 text-sm ${c.isInternal ? 'border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'bg-slate-50 dark:bg-slate-800/60'}`}
                      >
                        <p className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-medium text-slate-700 dark:text-slate-300">
                            {c.author?.displayName ?? 'System'}
                          </span>
                          {formatRelative(c.createdAt)}
                          {c.isInternal && (
                            <Badge tone="amber">
                              <Lock className="mr-1 h-3 w-3" />
                              Internal
                            </Badge>
                          )}
                        </p>
                        <p className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                          {c.body}
                        </p>
                      </div>
                    ))}
                    {!closed && can('ticket.comment') && (
                      <div className="space-y-2">
                        <Textarea
                          aria-label="Add a comment"
                          rows={3}
                          value={body}
                          onChange={(e) => setBody(e.target.value)}
                          placeholder="Write a reply…"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {staff ? (
                            <Checkbox
                              label="Internal note (hidden from requester)"
                              checked={internal}
                              onChange={(e) => setInternal(e.target.checked)}
                            />
                          ) : (
                            <span />
                          )}
                          <Button
                            disabled={!body.trim()}
                            loading={comment.isPending}
                            icon={<Send className="h-4 w-4" />}
                            onClick={() =>
                              act(async () => {
                                await comment.mutateAsync({ body, isInternal: internal });
                                setBody('');
                                setInternal(false);
                              }, 'Comment added')
                            }
                          >
                            Send
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Attachments" />
                  <CardBody>
                    <Documents
                      documents={t.documents}
                      owner={{ ticketId: t.id }}
                      invalidate={[`/tickets/${t.id}`]}
                      defaultType="PHOTO"
                    />
                  </CardBody>
                </Card>
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Details" />
                  <CardBody className="space-y-4">
                    <DetailList
                      columns={1}
                      items={[
                        {
                          label: 'Requester',
                          value: t.requester ? (
                            <Link
                              href={`/employees/${t.requester.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {fullName(t.requester)}
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                        { label: 'Category', value: label('ticketCategory', t.category) },
                        {
                          label: 'Asset',
                          value: t.asset ? (
                            <Link
                              href={`/assets/${t.asset.id}`}
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {t.asset.assetTag} — {t.asset.name}
                            </Link>
                          ) : (
                            '—'
                          ),
                        },
                        { label: 'Assignee', value: t.assignee?.displayName ?? 'Unassigned' },
                        ...(t.maintenance?.length
                          ? [
                              {
                                label: 'Maintenance',
                                value: t.maintenance.map((m) => (
                                  <Link
                                    key={m.id}
                                    href={`/maintenance/${m.id}`}
                                    className="block text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    {maintenanceRef(m.number)} {m.title}
                                  </Link>
                                )),
                              },
                            ]
                          : []),
                      ]}
                    />
                    {staff && !closed && (
                      <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                        {can('ticket.assign') && (
                          <Field label="Assign to">
                            {(p) => (
                              <StaffSelect
                                {...p}
                                value={t.assigneeId ?? ''}
                                onChange={(e) =>
                                  act(
                                    () =>
                                      assign.mutateAsync({ assigneeId: e.target.value || null }),
                                    'Assignee updated',
                                  )
                                }
                              />
                            )}
                          </Field>
                        )}
                        {t.status !== 'RESOLVED' && (
                          <Field label="Status">
                            {(p) => (
                              <Select
                                {...p}
                                value={t.status}
                                onChange={(e) =>
                                  act(
                                    () => update.mutateAsync({ status: e.target.value }),
                                    'Status updated',
                                  )
                                }
                              >
                                <option value="OPEN">Open</option>
                                <option value="IN_PROGRESS">In progress</option>
                                <option value="ON_HOLD">On hold</option>
                              </Select>
                            )}
                          </Field>
                        )}
                        <Field label="Priority">
                          {(p) => (
                            <Select
                              {...p}
                              value={t.priority}
                              onChange={(e) =>
                                act(
                                  () => update.mutateAsync({ priority: e.target.value }),
                                  'Priority updated',
                                )
                              }
                            >
                              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((v) => (
                                <option key={v} value={v}>
                                  {label('priority', v)}
                                </option>
                              ))}
                            </Select>
                          )}
                        </Field>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </div>
            </div>
            <Dialog
              open={resolving}
              onClose={() => setResolving(false)}
              title="Resolve ticket"
              description="The requester is notified and can close the ticket."
              footer={
                <>
                  <Button variant="secondary" onClick={() => setResolving(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={resolution.trim().length < 3}
                    loading={resolve.isPending}
                    onClick={() =>
                      act(async () => {
                        await resolve.mutateAsync({ resolution });
                        setResolving(false);
                      }, 'Ticket resolved')
                    }
                  >
                    Resolve
                  </Button>
                </>
              }
            >
              <Field label="How was it resolved?" required>
                {(p) => (
                  <Textarea
                    {...p}
                    rows={4}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  />
                )}
              </Field>
            </Dialog>
          </>
        );
      }}
    </QueryState>
  );
}
