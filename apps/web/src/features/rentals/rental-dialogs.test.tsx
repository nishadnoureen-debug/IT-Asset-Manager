// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RentalDialog, toLocalInput } from './rental-dialogs';

const mutateAsync = vi.fn();
/** The washing machine the mocked list returns; the factory below builds its own copy. */
const MACHINE_ID = 'item-1';

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
// The factory is hoisted, so the row it serves is built inside it.
vi.mock('@/lib/hooks', () => {
  const data = {
    data: [
      {
        id: 'item-1',
        campId: 'camp-1',
        type: 'WASHING_MACHINE',
        name: 'Washing machine 1',
        code: 'WM-01',
        provider: 'LG',
        standardCharge: 10,
        currency: 'AED',
        status: 'AVAILABLE',
        remarks: null,
        camp: { id: 'camp-1', name: 'Jebel Ali Camp', code: 'JAC' },
      },
    ],
  };
  return {
    useApi: () => ({ data }),
    useDebounced: <T,>(value: T) => value,
    useApiMutation: () => ({ mutateAsync, isPending: false }),
  };
});

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

describe('recording a rental', () => {
  it('gives a washing machine an hour of washing time and its usual charge', async () => {
    render(<RentalDialog open onClose={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText(/Item/), { target: { value: MACHINE_ID } });

    // Picking a machine turns the dialog into a washing time.
    const start = (await screen.findByLabelText(/Washing from/)) as HTMLInputElement;
    const end = (await screen.findByLabelText('Washing until')) as HTMLInputElement;
    await waitFor(() => expect(end.value).not.toBe(''));
    expect(new Date(end.value).getTime() - new Date(start.value).getTime()).toBe(60 * 60_000);
    expect((screen.getByLabelText('Charge') as HTMLInputElement).value).toBe('10');
  });

  it('asks who is renting it before sending anything', async () => {
    render(<RentalDialog open onClose={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText(/Item/), { target: { value: MACHINE_ID } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText('Choose who is renting it')).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});

describe('local datetime values', () => {
  it('round-trips an instant through the input format', () => {
    const value = toLocalInput('2026-09-20T17:00:00.000Z');
    expect(new Date(value).toISOString()).toBe('2026-09-20T17:00:00.000Z');
  });
});
