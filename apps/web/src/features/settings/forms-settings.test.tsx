// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsSettings } from './forms-settings';

const mutateAsync = vi.fn();
let canEdit = true;

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ can: () => canEdit }) }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/lib/hooks', () => {
  // One object for every render, like React Query's cached data (a new object each time would
  // re-run the form's reset effect forever).
  const query = {
    data: {
      data: {
        formFooter: 'ACME LLC | Dubai',
        formTerms: 'Keep it safe.\nReturn it on request.',
        formSignatories: [
          { title: 'HR Department', name: 'Jane Doe' },
          { title: 'IT Support', name: '' },
        ],
      },
    },
  };
  return {
    useApi: () => query,
    useApiMutation: () => ({ mutateAsync, isPending: false }),
  };
});

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({ data: {} });
  canEdit = true;
});
afterEach(cleanup);

describe('FormsSettings', () => {
  it('shows the saved footer, terms and signatories', async () => {
    render(<FormsSettings />);
    expect(((await screen.findByLabelText('Footer')) as HTMLTextAreaElement).value).toBe(
      'ACME LLC | Dubai',
    );
    expect((screen.getByLabelText('Terms & Conditions') as HTMLTextAreaElement).value).toContain(
      'Return it on request.',
    );
    expect((screen.getByLabelText('Signatory 1 name') as HTMLInputElement).value).toBe('Jane Doe');
    expect((screen.getByLabelText('Signatory 2 title') as HTMLInputElement).value).toBe(
      'IT Support',
    );
  });

  it('adds and removes signatories and saves trimmed values', async () => {
    render(<FormsSettings />);
    await screen.findByLabelText('Signatory 2 title');

    fireEvent.click(screen.getByRole('button', { name: 'Add signatory' }));
    fireEvent.change(screen.getByLabelText('Signatory 3 title'), {
      target: { value: '  Finance Manager ' },
    });
    fireEvent.change(screen.getByLabelText('Signatory 3 name'), { target: { value: ' Sam Lee ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove signatory 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save form settings' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      formFooter: 'ACME LLC | Dubai',
      formTerms: 'Keep it safe.\nReturn it on request.',
      formSignatories: [
        { title: 'HR Department', name: 'Jane Doe' },
        { title: 'Finance Manager', name: 'Sam Lee' },
      ],
    });
  });

  it('is read-only without the settings.edit permission', async () => {
    canEdit = false;
    render(<FormsSettings />);
    expect((await screen.findByLabelText('Footer')).closest('fieldset')?.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save form settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add signatory' })).toBeNull();
  });
});
