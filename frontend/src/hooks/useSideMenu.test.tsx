import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSideMenu } from './useSideMenu';
import { createRouterWrapper, renderHookWithRouter, renderHookWithRouterAndLocation } from '@/test/test-utils';

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
});
