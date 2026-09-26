// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimUsageDialog } from './sim-dialogs';

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
