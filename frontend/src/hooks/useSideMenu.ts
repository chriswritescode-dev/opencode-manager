import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readPreviousSearch, useUrlParams } from './useUrlParams';
import {
  encodeProjectTarget,
  parseProjectTarget,
  projectTargetFromRoute,
  type ProjectTarget,
} from '@/lib/projectTarget';

/** The side menu page to show while it is open. */
export type SideMenuPage = 'home' | 'sessions';

type UrlHistoryMode = 'push' | 'replace';

/** A request to open the side menu on a page, optionally scoped to a project. */
export interface OpenSideMenuOptions {
  page: SideMenuPage;
  project?: ProjectTarget;
}

/** Side menu URL state and the actions that write it. */
export interface UseSideMenuReturn {
  isOpen: boolean;
  page: SideMenuPage;
  project: ProjectTarget | null;
  openMenu: (options: OpenSideMenuOptions, mode?: UrlHistoryMode) => void;
  setPage: (page: SideMenuPage) => void;
  closeMenu: () => void;
  navigateFromMenu: (path: string) => void;
}

/**
 * Reads and writes the side menu's `menu` and `menuProject` URL params.
 *
 * @returns The open state, the requested page, the project in view, and the open, set-page and close actions.
 */
export function useSideMenu(): UseSideMenuReturn {
  const location = useLocation();
  const navigate = useNavigate();
  const { searchParams, updateParams, closePushedParams } = useUrlParams();

  const menuParam = searchParams.get('menu');
  const isOpen = menuParam === 'home' || menuParam === 'sessions';
  const page: SideMenuPage = menuParam === 'sessions' ? 'sessions' : 'home';

  const project = useMemo(
    () =>
      parseProjectTarget(searchParams.get('menuProject')) ??
      projectTargetFromRoute(location.pathname, location.search),
    [searchParams, location.pathname, location.search],
  );

  const openMenu = useCallback(
    (options: OpenSideMenuOptions, mode: UrlHistoryMode = 'push') => {
      updateParams((params) => {
        params.set('menu', options.page);
        if (options.project) {
          params.set('menuProject', encodeProjectTarget(options.project));
        } else {
          params.delete('menuProject');
        }
      }, mode);
    },
    [updateParams],
  );

  const setPage = useCallback(
    (nextPage: SideMenuPage) => {
      updateParams((params) => params.set('menu', nextPage));
    },
    [updateParams],
  );

  const closeMenu = useCallback(() => {
    closePushedParams((params) => {
      params.delete('menu');
      params.delete('menuProject');
    });
  }, [closePushedParams]);

  /**
   * Leaves the menu for a path in one history operation, so a pending route loader is never aborted
   * by the traversal `closeMenu` would start.
   */
  const navigateFromMenu = useCallback(
    (path: string) => {
      if (readPreviousSearch(location.state) !== null) {
        navigate(path, { replace: true });
        return;
      }
      navigate(path);
    },
    [location.state, navigate],
  );

  return { isOpen, page, project, openMenu, setPage, closeMenu, navigateFromMenu };
}
