// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimSwapDialog, SimUsageDialog } from './sim-dialogs';
import type { SimCard } from '@/lib/types';

const mutateAsync = vi.fn();

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/hooks', () => ({
  useApi: () => ({ data: undefined }),
  useDebounced: <T,>(value: T) => value,
  useApiMutation: () => ({ mutateAsync, isPending: false }),
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

beforeEach(() => mutateAsync.mockReset().mockResolvedValue({ data: {} }));
afterEach(cleanup);

describe('recording a month for a SIM', () => {
  it('starts from the plan charge and sends every charge column', async () => {
    render(<SimUsageDialog open simCardId="sim-1" planCharge={150} onClose={vi.fn()} />);

    // The plan's monthly charge is filled in, ready to accept or change.
    const monthly = (await screen.findByLabelText('Monthly charges')) as HTMLInputElement;
    expect(monthly.value).toBe('150');

    fireEvent.change(screen.getByLabelText(/Billing month/), { target: { value: '2026-09' } });
    fireEvent.change(screen.getByLabelText('Excess usage'), { target: { value: '24.5' } });
    fireEvent.change(screen.getByLabelText('International charges'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Roaming charges'), { target: { value: '65.25' } });
    fireEvent.change(screen.getByLabelText('Parking charges'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'Site visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record month' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      period: '2026-09-01',
      monthlyCharge: 150,
      excessUsage: 24.5,
      internationalCharges: 10,
      roamingCharges: 65.25,
      parkingCharges: 0,
      remarks: 'Site visit',
    });
  });

  it('leaves blank charges out so the API keeps its own defaults', async () => {
    render(<SimUsageDialog open simCardId="sim-1" onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Billing month/), {
      target: { value: '2026-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record month' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      period: '2026-10-01',
      monthlyCharge: undefined,
      excessUsage: undefined,
      internationalCharges: undefined,
      roamingCharges: undefined,
      parkingCharges: undefined,
      remarks: undefined,
    });
  });
});

const CARD = {
  id: 'sim-1',
  phoneNumber: '0500000009',
  simNumber: '8997100000000000009',
  provider: 'e&',
  status: 'ACTIVE',
  planId: null,
  employeeId: 'emp-1',
  assetId: null,
  activatedAt: null,
  cancelledAt: null,
  remarks: null,
  plan: null,
  employee: { id: 'emp-1', firstName: 'Omar', lastName: 'Haddad', employeeNumber: 'EMP101' },
  asset: null,
} as unknown as SimCard;

describe('swapping a SIM card', () => {
  it('sends the reason, its detail and the replacement SIM', async () => {
    const onClose = vi.fn();
    render(<SimSwapDialog open card={CARD} onClose={onClose} />);

    // The current holder is named, so it is clear who hands the line over.
    expect(await screen.findByText(/Omar Haddad hands the line over/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Reason for swap'), { target: { value: 'STOLEN' } });
    // The detail field is labelled for the reason that was chosen.
    fireEvent.change(await screen.findByLabelText('Police report number'), {
      target: { value: 'Bur Dubai 2026/4471' },
    });
    fireEvent.change(screen.getByLabelText(/Replacement SIM/), {
      target: { value: '8997100000000000010' },
    });
    fireEvent.change(screen.getByLabelText('Swapped on'), { target: { value: '2026-09-20' } });
    fireEvent.change(screen.getByLabelText('Remarks'), { target: { value: 'Stolen on site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record swap' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      // Nobody was picked, so the line goes back into stock.
      toEmployeeId: null,
      reason: 'STOLEN',
      reasonDetail: 'Bur Dubai 2026/4471',
      newSimNumber: '8997100000000000010',
      swappedAt: '2026-09-20',
      remarks: 'Stolen on site',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
