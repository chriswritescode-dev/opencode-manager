import { renderHook, act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import { useSideMenu } from './useSideMenu';
import { createRouterWrapper, renderHookWithRouter, renderHookWithRouterAndLocation } from '@/test/test-utils';

function MenuNavigationHarness() {
  const { openMenu, navigateFromMenu } = useSideMenu();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <div data-testid="navigation-type">{navigationType}</div>
      <button type="button" onClick={() => openMenu({ page: 'sessions' })}>open-menu</button>
      <button type="button" onClick={() => navigateFromMenu('/repos/1/sessions/b')}>open-session</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
    </div>
  );
}

describe('useSideMenu', () => {
  it('is closed and on the home page without menu params', () => {
    const { result } = renderHookWithRouter(() => useSideMenu());
    expect(result.current.isOpen).toBe(false);
    expect(result.current.page).toBe('home');
    expect(result.current.project).toBeNull();
  });

  it('reads the open state and page from the menu param', () => {
    const home = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=home']),
    });
    expect(home.result.current.isOpen).toBe(true);
    expect(home.result.current.page).toBe('home');

    const sessions = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=sessions']),
    });
    expect(sessions.result.current.isOpen).toBe(true);
    expect(sessions.result.current.page).toBe('sessions');

    const invalid = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=other']),
    });
    expect(invalid.result.current.isOpen).toBe(false);
    expect(invalid.result.current.page).toBe('home');
  });

  it('reads the project from menuProject', () => {
    const repo = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=sessions&menuProject=repo:7']),
    });
    expect(repo.result.current.project).toEqual({ kind: 'repo', repoId: 7 });

    const server = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=sessions&menuProject=server:srv_kitchen:%2Fhome%2Fme%2Fapp']),
    });
    expect(server.result.current.project).toEqual({
      kind: 'server',
      serverId: 'srv_kitchen',
      directory: '/home/me/app',
    });
  });

  it('falls back to the route project when menuProject is absent or invalid', () => {
    const fromRoute = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/repos/5']),
    });
    expect(fromRoute.result.current.project).toEqual({ kind: 'repo', repoId: 5 });

    const invalidParam = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/repos/5?menu=sessions&menuProject=broken']),
    });
    expect(invalidParam.result.current.project).toEqual({ kind: 'repo', repoId: 5 });
  });

  it('opens the requested page even when the menu was left elsewhere', () => {
    const { result } = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=home']),
    });

    act(() => {
      result.current.openMenu({ page: 'sessions', project: { kind: 'repo', repoId: 9 } });
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.page).toBe('sessions');
    expect(result.current.project).toEqual({ kind: 'repo', repoId: 9 });
  });

  it('drops a stale menuProject when opened without a project', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useSideMenu(),
      ['/?menu=sessions&menuProject=repo:3'],
    );

    act(() => {
      result.current.openMenu({ page: 'home' });
    });

    expect(result.current.page).toBe('home');
    expect(result.current.project).toBeNull();
    expect(capturedSearch.current).not.toContain('menuProject');
  });

  it('changes page without leaving the menu', () => {
    const { result } = renderHook(() => useSideMenu(), {
      wrapper: createRouterWrapper(['/?menu=home']),
    });

    act(() => {
      result.current.setPage('sessions');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.page).toBe('sessions');
  });

  it('closes a deep-linked menu by removing both params', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(
      () => useSideMenu(),
      ['/?menu=home&menuProject=repo:3'],
    );

    act(() => {
      result.current.closeMenu();
    });

    expect(result.current.isOpen).toBe(false);
    expect(result.current.project).toBeNull();
    expect(capturedSearch.current).toBe('');
  });

  it('closes a menu it opened by going back to the previous search', () => {
    const { result, capturedSearch } = renderHookWithRouterAndLocation(() => useSideMenu(), ['/']);

    act(() => {
      result.current.openMenu({ page: 'sessions', project: { kind: 'repo', repoId: 2 } });
    });
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.closeMenu();
    });

    expect(result.current.isOpen).toBe(false);
    expect(capturedSearch.current).toBe('');
  });

  it('replaces a pushed menu entry when leaving the menu', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <MenuNavigationHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'open-menu' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/?menu=sessions');
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('PUSH');

    await user.click(screen.getByRole('button', { name: 'open-session' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/b');
    expect(screen.getByTestId('location')).not.toHaveTextContent('menu=');
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');

    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/));
  });

  it('pushes from a deep-linked menu entry', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/?menu=sessions']}>
        <MenuNavigationHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'open-session' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/repos/1/sessions/b');
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('PUSH');

    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/?menu=sessions'));
  });
});
