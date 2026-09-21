// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api-client';
import RegisterPage from './page';

const replace = vi.fn();
const login = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ login, status: 'unauthenticated' }) }));
vi.mock('@/lib/api-client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api-client')>();
  return { ...actual, api: { get: vi.fn(), post: vi.fn() } };
});

const PASSWORD = 'Example-2026';

function options(requiresApproval: boolean) {
  vi.mocked(api.get).mockResolvedValue({ data: { enabled: true, requiresApproval } } as never);
}

async function fillAndSubmit(email = 'new.person@example.com') {
  fireEvent.change(await screen.findByLabelText(/Full name/), { target: { value: 'New Person' } });
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: PASSWORD } });
  fireEvent.submit(screen.getByLabelText(/Full name/).closest('form')!);
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('RegisterPage', () => {
  it('signs the new user in with the registered details and opens the dashboard', async () => {
    options(false);
    vi.mocked(api.post).mockResolvedValue({
      data: { status: 'ACTIVE', message: 'Your account is ready.' },
    } as never);
    render(<RegisterPage />);
    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeTruthy();

    await fillAndSubmit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(api.post).toHaveBeenCalledWith(
      '/auth/register',
      { displayName: 'New Person', email: 'new.person@example.com', password: PASSWORD },
      { anonymous: true },
    );
    expect(login).toHaveBeenCalledWith('new.person@example.com', PASSWORD);
  });

  it('explains when the email already has an account', async () => {
    options(false);
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'EMAIL_TAKEN', 'taken'));
    render(<RegisterPage />);

    await fillAndSubmit('taken@example.com');
    expect(await screen.findByText('An account with this email already exists')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in with this email' }).getAttribute('href')).toBe(
      '/login?email=taken%40example.com',
    );
    expect(login).not.toHaveBeenCalled();
  });

  it('shows a pending confirmation instead of signing in when approval is required', async () => {
    options(true);
    vi.mocked(api.post).mockResolvedValue({
      data: { status: 'PENDING', message: 'Request received.' },
    } as never);
    render(<RegisterPage />);
    expect(await screen.findByRole('heading', { name: 'Request access' })).toBeTruthy();

    await fillAndSubmit();
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
