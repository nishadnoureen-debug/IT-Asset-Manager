// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@itam/shared';
import { NAV } from '@/lib/nav';
import { BarList } from './bar-list';
import { Badge, StatusBadge } from './ui/badge';
import { DataTable } from './ui/data-table';
import { ErrorState } from './ui/states';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders the human label with a tone', () => {
    render(<StatusBadge group="assetStatus" value="IN_REPAIR" />);
    const badge = screen.getByText('In repair');
    expect(badge.className).toMatch(/amber/);
  });

  it('renders a dash for empty values', () => {
    render(<StatusBadge group="assetStatus" value={null} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('falls back to the raw value for unknown enums', () => {
    render(<Badge>custom</Badge>);
    expect(screen.getByText('custom')).toBeTruthy();
  });
});

describe('DataTable', () => {
  const columns = [
    {
      key: 'name',
      header: 'Name',
      sort: 'name',
      cell: (r: { id: string; name: string }) => r.name,
    },
  ];

  it('renders rows, sorts and paginates', () => {
    const onSort = vi.fn();
    const onPage = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={[
          { id: '1', name: 'Latitude' },
          { id: '2', name: 'ThinkPad' },
        ]}
        sortBy="name"
        sortOrder="asc"
        onSort={onSort}
        meta={{ page: 1, limit: 2, total: 3, totalPages: 2 }}
        onPage={onPage}
      />,
    );
    expect(screen.getByText('Latitude')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /name/i }));
    expect(onSort).toHaveBeenCalledWith('name', 'desc');
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(onPage).toHaveBeenCalledWith(2);
    expect(screen.getByText('1–2 of 3')).toBeTruthy();
  });

  it('shows the empty state', () => {
    render(<DataTable columns={columns} rows={[]} empty={<p>No assets yet</p>} />);
    expect(screen.getByText('No assets yet')).toBeTruthy();
  });

  it('shows friendly copy for not-found and forbidden errors', () => {
    render(
      <ErrorState
        error={Object.assign(new Error('x'), { code: 'NOT_FOUND' })}
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByText(/does not exist or you do not have access/)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});

describe('BarList', () => {
  it('prints every value as text and links each bar', () => {
    render(
      <BarList
        data={[
          { key: 'ASSIGNED', label: 'Assigned', value: 12, href: '/assets?status=ASSIGNED' },
          { key: 'IN_STOCK', label: 'In stock', value: 6, href: '/assets?status=IN_STOCK' },
        ]}
        total={18}
      />,
    );
    expect(screen.getByText('12')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Assigned: 12 assets (67%)' });
    expect(link.getAttribute('href')).toBe('/assets?status=ASSIGNED');
  });
});

describe('navigation', () => {
  const visibleFor = (role: keyof typeof ROLE_PERMISSIONS) => {
    const perms = new Set<string>(ROLE_PERMISSIONS[role]);
    return NAV.filter((n) => n.anyOf.some((p) => perms.has(p))).map((n) => n.href);
  };

  it('shows employees only their workspace items', () => {
    expect(visibleFor('EMPLOYEE')).toEqual(['/dashboard', '/assets', '/requests']);
  });

  it('keeps administration out of the technician menu', () => {
    const items = visibleFor('IT_TECHNICIAN');
    expect(items).toContain('/scan');
    expect(items).not.toContain('/users');
    expect(items).not.toContain('/activity-logs');
  });

  it('gives Super Admins everything', () => {
    expect(visibleFor('SUPER_ADMIN')).toHaveLength(NAV.length);
  });
});
