// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import RequestDetailPage from './page';

const fulfil = vi.fn();
const assetQueries: Record<string, unknown>[] = [];

const REQUEST = {
  id: 'req-1',
  number: 7,
  title: 'Laptop for site work',
  justification: 'Needs the survey software.',
  type: 'NEW_ASSET',
  priority: 'HIGH',
  status: 'APPROVED',
  quantity: 1,
  neededBy: null,
  decisionNotes: 'Approved',
  decisionAt: '2026-09-20T08:00:00.000Z',
  fulfilledAt: null,
  cancelledAt: null,
  createdAt: '2026-09-19T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  createdById: 'user-1',
  employeeId: 'emp-1',
  employee: { id: 'emp-1', firstName: 'Omar', lastName: 'Haddad', employeeNumber: 'EMP101' },
  assetType: { id: 'type-laptop', name: 'Laptop' },
  createdBy: { id: 'user-1', displayName: 'IT' },
  decisionBy: { id: 'user-1', displayName: 'IT' },
  asset: null,
  documents: [],
};

const ACCESSORIES = [
  { id: 'acc-1', name: 'Wireless mouse', quantityAvailable: 4 },
  { id: 'acc-2', name: 'Laptop bag', quantityAvailable: 0 },
];

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'req-1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ can: () => true, user: { id: 'user-1' } }) }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/components/documents', () => ({ Documents: () => <div>documents</div> }));
vi.mock('@/lib/hooks', () => ({
  useApi: (path: string | null, query?: Record<string, unknown>) => {
    if (path === '/requests/req-1')
      return { isLoading: false, error: null, data: { data: REQUEST }, refetch: vi.fn() };
    if (path === '/accessories')
      return { isLoading: false, error: null, data: { data: ACCESSORIES }, refetch: vi.fn() };
    if (path === '/assets') {
      assetQueries.push(query ?? {});
      return { isLoading: false, error: null, data: { data: [] }, refetch: vi.fn() };
    }
    return { isLoading: false, error: null, data: undefined, refetch: vi.fn() };
  },
  useDebounced: <T,>(value: T) => value,
  useApiMutation: (_method: string, path: string) => ({
    mutateAsync: path.endsWith('/fulfil') ? fulfil : vi.fn(),
    isPending: false,
  }),
}));

// jsdom has no native <dialog> behaviour.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

beforeEach(() => {
  fulfil.mockReset().mockResolvedValue({ data: {} });
  assetQueries.length = 0;
});
afterEach(cleanup);

describe('recording a handover from an approved request', () => {
  it('offers free assets of the requested type and accessories that are in stock', async () => {
    render(<RequestDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record handover' }));

    // The asset search is limited to assets nobody holds, of the type that was asked for.
    const picker = screen.getByPlaceholderText(/Search free assets/);
    fireEvent.focus(picker);
    await waitFor(() => expect(assetQueries.length).toBeGreaterThan(0));
    expect(assetQueries.at(-1)).toMatchObject({
      status: 'IN_STOCK,AVAILABLE',
      assetTypeId: 'type-laptop',
    });

    // Accessories list their stock; an out-of-stock one is not offered.
    const accessorySelect = screen.getByLabelText('Add accessory');
    expect(within(accessorySelect).getByText('Wireless mouse (4 available)')).toBeTruthy();
    expect(within(accessorySelect).queryByText(/Laptop bag/)).toBeNull();
  });

  it('sends the asset, condition and accessory quantities', async () => {
    render(<RequestDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Record handover' }));

    fireEvent.change(screen.getByLabelText('Condition at handover'), { target: { value: 'NEW' } });
    fireEvent.change(screen.getByLabelText('Add accessory'), { target: { value: 'acc-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));

    // Without an asset the accessories cannot be handed over, so the form says so.
    expect(await screen.findByText('Choose the asset being handed over')).toBeTruthy();
    expect(fulfil).not.toHaveBeenCalled();
  });
});
