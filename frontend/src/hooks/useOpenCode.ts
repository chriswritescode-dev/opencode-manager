import { useQuery, useMutation, useQueryClient, useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useMemo, useRef, useEffect, useCallback } from "react";
import {
  createSession,
  deleteSession,
  getSession,
  listSessionPage,
  renameSession,
  activateSkill,
  interruptSession,
  backgroundSession,
  listAgents,
  listSkills,
  runShell,
  sendPrompt,
  switchSessionAgent,
  switchSessionModel,
  type PromptAgentInput,
  type PromptFileInput,
  type PromptSkillInput,
} from "../api/opencode";
import { FetchError } from "../api/fetchWrapper";
import type { ModelRef, SessionInfo } from "@opencode-manager/shared/opencode";
import { isSameModelRef } from "@opencode-manager/shared/opencode";
import { parseNetworkError, isGatewayTimeout } from "../lib/opencode-errors";
import { showToast } from "../lib/toast";
import { useSendErrorStore } from "../stores/sendErrorStore";
import { useSessionStatus, useChildLifecycleForSession } from "../stores/sessionStatusStore";
import { isRunningLifecycle } from "../lib/backgroundWork";
import { childSessionReconciliationQueryKey, invalidateSessionListCaches, sessionTranscriptQueryKey } from "../lib/queryInvalidation";
import { buildPinnedSessionKeys, buildSessionKey } from "../lib/sessionKey";
import { toggleSessionPin } from "../api/sessionPins";
import { SESSION_PINS_QUERY_KEY } from "./useSessionPins";
import { admitInboxItem, type TranscriptCache } from "../lib/session-projection";
import type { SessionPin } from "@opencode-manager/shared/schemas";

const SESSION_LIST_PAGE_SIZE = 25

const EMPTY_SESSIONS: SessionInfo[] = []

interface UseSessionsAcrossDirectoriesOptions {
  search?: string
  limit?: number
  keepPreviousResults?: boolean
  allDirectories?: boolean
  project?: { id: string; subpath: string }
}

type SessionDirectoryCursors = Record<string, string>

type SessionListPageParam =
  | { mode: 'directories'; cursors: SessionDirectoryCursors }
  | { mode: 'all'; cursor: string }

interface SessionListPage {
  items: SessionInfo[]
  nextParam?: SessionListPageParam
}

export const useSessionsAcrossDirectories = (
  directories: string[],
  options?: UseSessionsAcrossDirectoriesOptions,
) => {
  const uniqueDirectories = useMemo(
    () => Array.from(new Set(directories.filter(Boolean))),
    [directories],
  );
  const normalizedSearch = options?.search?.trim() || undefined;
  const limit = options?.limit ?? SESSION_LIST_PAGE_SIZE;
  const keepPreviousResults = options?.keepPreviousResults ?? false;
  const allDirectories = options?.allDirectories ?? false;
  const projectId = options?.project?.id;
  const projectSubpath = options?.project?.subpath;
  const projectScoped = !allDirectories && projectId !== undefined;
  const singleCursor = allDirectories || projectScoped;
  const directoryKey = uniqueDirectories.join('|');

  const query = useInfiniteQuery<
    SessionListPage,
    Error,
    InfiniteData<SessionListPage, SessionListPageParam | undefined>,
    readonly unknown[],
    SessionListPageParam | undefined
  >({
    queryKey: [
      'opencode',
      'sessions',
      directoryKey,
      { search: normalizedSearch, limit, allDirectories, project: projectId, subpath: projectSubpath },
    ],
    queryFn: async ({ pageParam }) => {
      if (singleCursor) {
        const cursor = pageParam?.mode === 'all' ? pageParam.cursor : undefined;
        const page = await listSessionPage(
          cursor === undefined
            ? {
                limit,
                order: 'desc',
                search: normalizedSearch,
                ...(projectScoped ? { project: projectId, subpath: projectSubpath } : {}),
              }
            : { cursor },
        );
        return {
          items: page.items,
          nextParam: page.nextCursor ? { mode: 'all', cursor: page.nextCursor } : undefined,
        };
      }

      if (!pageParam || pageParam.mode !== 'directories') {
        const pages = await Promise.all(
          uniqueDirectories.map((directory) =>
            listSessionPage({
              directory,
              limit,
              order: 'desc',
              search: normalizedSearch,
            }),
          ),
        );
        const cursors: SessionDirectoryCursors = {};
        const items: SessionInfo[] = [];
        for (let i = 0; i < pages.length; i++) {
          items.push(...pages[i].items);
          if (pages[i].nextCursor) {
            cursors[uniqueDirectories[i]] = pages[i].nextCursor!;
          }
        }
        return {
          items,
          nextParam: Object.keys(cursors).length > 0 ? { mode: 'directories', cursors } : undefined,
        };
      }

      const entries = Object.entries(pageParam.cursors);
      const pages = await Promise.all(
        entries.map(([directory, cursor]) => listSessionPage({ directory, cursor })),
      );
      const cursors: SessionDirectoryCursors = {};
      const items: SessionInfo[] = [];
      for (let i = 0; i < pages.length; i++) {
        items.push(...pages[i].items);
        if (pages[i].nextCursor) {
          cursors[entries[i][0]] = pages[i].nextCursor!;
        }
      }
      return {
        items,
        nextParam: Object.keys(cursors).length > 0 ? { mode: 'directories', cursors } : undefined,
      };
    },
    initialPageParam: undefined as SessionListPageParam | undefined,
    placeholderData: keepPreviousResults
      ? (previousData, previousQuery) => {
          if (!previousQuery) return undefined
          const sameDirectory = previousQuery.queryKey[2] === directoryKey
          const previousProject = (previousQuery.queryKey[3] as { project?: string } | undefined)?.project
          return sameDirectory && previousProject === projectId ? previousData : undefined
        }
      : undefined,
    getNextPageParam: (lastPage) => lastPage.nextParam,
    enabled: uniqueDirectories.length > 0,
    staleTime: 10000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const data = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? EMPTY_SESSIONS,
    [query.data],
  );

  return {
    data,
    isLoading: query.isLoading,
    isPlaceholderData: query.isPlaceholderData,
    isError: query.isError,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    error: query.error,
  };
};

const sessionQueryKey = (sessionID: string | undefined, directory?: string) =>
  ["opencode", "session", sessionID, directory] as const;

export const sessionQueryOptions = (sessionID: string | undefined, directory?: string) => ({
  queryKey: sessionQueryKey(sessionID, directory),
  queryFn: () => getSession(sessionID!),
  enabled: !!sessionID,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  staleTime: 15000,
  retry: (failureCount: number, error: unknown) =>
    !(error instanceof FetchError && error.statusCode === 404) && failureCount < 3,
});

export const useSession = (sessionID: string | undefined, directory?: string) => {
  return useQuery(sessionQueryOptions(sessionID, directory));
};

export const useChildSessionReconciliation = (sessionID: string | undefined) => {
  const lifecycle = useChildLifecycleForSession(sessionID)
  useQuery({
    queryKey: childSessionReconciliationQueryKey(sessionID),
    queryFn: async () => {
      const token = useSessionStatus.getState().beginStatusSnapshot();
      try {
        const session = await getSession(sessionID!);
        useSessionStatus.getState().applySessionSnapshot(sessionID!, session, token);
        return session;
      } finally {
        useSessionStatus.getState().endStatusSnapshot(token);
      }
    },
    enabled: !!sessionID && isRunningLifecycle(lifecycle),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
};

export const useCreateSession = (
  directory?: string,
  onSuccess?: (session: { id: string }) => void,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      title?: string;
      agent?: string;
      model?: string;
      directory?: string;
    }) => {
      const targetDirectory = data.directory ?? directory;
      if (!targetDirectory) {
        throw new Error('A directory is required to create a session');
      }
      return createSession({ ...data, directory: targetDirectory });
    },
    onSuccess: (session) => {
      invalidateSessionListCaches(queryClient);
      onSuccess?.(session);
    },
    onError: (error) => {
      const parsed = parseNetworkError(error);
      showToast.error(parsed.title, {
        description: parsed.message,
        duration: 5000,
      });
    },
  });
};

export type DeleteSessionTarget = string | { id: string; directory?: string };

const getDeleteSessionTargetId = (target: DeleteSessionTarget) =>
  typeof target === 'string' ? target : target.id;

const getDeleteSessionTargetDirectory = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  typeof target === 'string' ? fallbackDirectory : target.directory ?? fallbackDirectory;

const getDeleteSessionTargetKey = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  buildSessionKey(getDeleteSessionTargetDirectory(target, fallbackDirectory), getDeleteSessionTargetId(target));

export const useDeleteSession = (directory?: string | string[]) => {
  const queryClient = useQueryClient();
  const directories = useMemo(
    () => (Array.isArray(directory) ? directory : directory ? [directory] : []),
    [directory],
  );
  const primaryDirectory = directories[0];

  return useMutation({
    mutationFn: async (sessionIDs: DeleteSessionTarget | DeleteSessionTarget[]) => {
      const targets = Array.from(
        new Map(
          (Array.isArray(sessionIDs) ? sessionIDs : [sessionIDs]).map((target) => [
            getDeleteSessionTargetKey(target, primaryDirectory),
            target,
          ]),
        ).values(),
      )

      const results: PromiseSettledResult<void>[] = []
      for (const target of targets) {
        try {
          await deleteSession(getDeleteSessionTargetId(target))
          results.push({ status: 'fulfilled', value: undefined })
        } catch (reason) {
          results.push({ status: 'rejected', reason })
        }
      }
      const failures = results.filter(result => result.status === 'rejected')

      if (failures.length > 0) {
        throw new Error(`Failed to delete ${failures.length} session(s)`)
      }

      return { deleted: targets.length, results }
    },
    onSuccess: ({ deleted }, variables) => {
      removeDeletedSessionsFromListCaches(queryClient, variables);
      cleanupSessionPins(queryClient, variables, primaryDirectory);
      showToast.success(deleted === 1 ? 'Session deleted' : `${deleted} sessions deleted`);
    },
    onError: (_error, variables) => {
      invalidateSessionListCaches(queryClient);
      cleanupSessionPins(queryClient, variables, primaryDirectory);
      showToast.error('Failed to delete sessions');
    },
  });
};

const removeDeletedSessionsFromListCaches = (
  queryClient: ReturnType<typeof useQueryClient>,
  variables: DeleteSessionTarget | DeleteSessionTarget[],
) => {
  const deletedIDs = new Set(
    (Array.isArray(variables) ? variables : [variables]).map(getDeleteSessionTargetId),
  );
  if (deletedIDs.size === 0) return;
  queryClient.setQueriesData<InfiniteData<SessionListPage, SessionListPageParam | undefined>>(
    { queryKey: ['opencode', 'sessions'] },
    (current) => {
      if (!current) return current;
      let changed = false;
      const pages = current.pages.map((page) => {
        const items = page.items.filter((item) => !deletedIDs.has(item.id));
        if (items.length === page.items.length) return page;
        changed = true;
        return { ...page, items };
      });
      return changed ? { ...current, pages } : current;
    },
  );
};

const cleanupSessionPins = (
  queryClient: ReturnType<typeof useQueryClient>,
  variables: DeleteSessionTarget | DeleteSessionTarget[],
  primaryDirectory?: string,
) => {
  const pins = queryClient.getQueryData<SessionPin[]>(SESSION_PINS_QUERY_KEY) ?? [];
  if (pins.length === 0) return;
  const pinnedKeys = buildPinnedSessionKeys(pins);
  const targets = (Array.isArray(variables) ? variables : [variables])
    .map((target) => ({
      sessionId: getDeleteSessionTargetId(target),
      directory: getDeleteSessionTargetDirectory(target, primaryDirectory) ?? '',
    }))
    .filter((target) => pinnedKeys.has(buildSessionKey(target.directory, target.sessionId)));
  if (targets.length === 0) return;
  void Promise.allSettled(
    targets.map((target) => toggleSessionPin({ ...target, pinned: false })),
  ).then(() => {
    void queryClient.invalidateQueries({ queryKey: SESSION_PINS_QUERY_KEY });
  });
};

export const useUpdateSession = (directory?: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sessionID, title }: { sessionID: string; title: string }) => {
      return renameSession(sessionID, title);
    },
    onSuccess: (_, variables) => {
      const { sessionID } = variables;
      queryClient.invalidateQueries({ queryKey: sessionQueryKey(sessionID, directory) });
      invalidateSessionListCaches(queryClient);
    },
  });
};

const patchCachedSessionSelection = (
  queryClient: ReturnType<typeof useQueryClient>,
  sessionID: string,
  directory: string | undefined,
  patch: Partial<Pick<SessionInfo, 'model' | 'agent'>>,
) => {
  queryClient.setQueryData<SessionInfo>(sessionQueryKey(sessionID, directory), (current) =>
    current ? { ...current, ...patch } : current,
  );
};

export const useSyncSessionSelection = (directory?: string) => {
  const queryClient = useQueryClient();

  return useCallback(
    async ({
      sessionID,
      model,
      agent,
    }: {
      sessionID: string;
      model?: ModelRef;
      agent?: string;
    }) => {
      const session = queryClient.getQueryData<SessionInfo>(
        sessionQueryKey(sessionID, directory),
      );

      let agentChanged = false;
      if (agent && agent !== session?.agent) {
        await switchSessionAgent(sessionID, agent);
        patchCachedSessionSelection(queryClient, sessionID, directory, { agent });
        agentChanged = true;
      }

      if (model && (agentChanged || !isSameModelRef(model, session?.model))) {
        await switchSessionModel(sessionID, model);
        patchCachedSessionSelection(queryClient, sessionID, directory, { model });
      }
    },
    [queryClient, directory],
  );
};

export const useSendPrompt = (directory?: string) => {
  const queryClient = useQueryClient();
  const syncSelection = useSyncSessionSelection(directory);

  return useMutation({
    mutationFn: async ({
      sessionID,
      text,
      files,
      agents,
      skills,
      model,
      agent,
      delivery,
    }: {
      sessionID: string;
      text: string;
      files?: PromptFileInput[];
      agents?: PromptAgentInput[];
      skills?: PromptSkillInput[];
      model?: ModelRef;
      agent?: string;
      delivery?: 'steer' | 'queue';
    }) => {
      useSessionStatus.getState().setOptimisticActive(sessionID);

      await syncSelection({ sessionID, model, agent });

      const inbox = await sendPrompt({ sessionID, text, files, agents, skills, delivery });

      queryClient.setQueryData<TranscriptCache>(
        sessionTranscriptQueryKey(sessionID),
        (current) => {
          if (!current) return current;
          if (current.transcript.messages.some((message) => message.id === inbox.id)) {
            return current;
          }
          const transcript = admitInboxItem(current.transcript, inbox);
          return transcript === current.transcript ? current : { ...current, transcript };
        },
      );

      return inbox;
    },
    onError: (error, variables) => {
      const { sessionID, text } = variables;

      if (isGatewayTimeout(error)) {
        return;
      }

      useSessionStatus.getState().clearStatus(sessionID);

      const parsed = parseNetworkError(error);
      useSendErrorStore.getState().setError({
        sessionID,
        title: parsed.title,
        message: parsed.message,
        detail: error instanceof FetchError ? error.detail : undefined,
        failedPrompt: text || undefined,
        kind: 'network',
      });
    },
    onSuccess: (_inbox, variables) => {
      useSendErrorStore.getState().clearError(variables.sessionID);
    },
  });
};

export const useBackgroundSession = () => {
  return useMutation({
    mutationFn: (sessionID: string) => backgroundSession(sessionID),
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to move work to the background");
    },
  });
};

const ABORT_RETRY_INTERVAL_MS = 3000;
const MAX_ABORT_RETRIES = 10;

export const useInterruptSession = () => {
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const stopRetrying = useCallback(() => {
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    retryCountRef.current = 0;
  }, []);

  useEffect(() => {
    return () => stopRetrying();
  }, [stopRetrying]);

  const mutation = useMutation({
    mutationFn: async (targetSessionID: string) => {
      stopRetrying();

      const attemptAbort = async () => {
        try {
          await interruptSession(targetSessionID);
          stopRetrying();
        } catch {
          // Will retry on next interval
        }
      };

      attemptAbort();

      retryIntervalRef.current = setInterval(() => {
        retryCountRef.current++;

        if (retryCountRef.current >= MAX_ABORT_RETRIES) {
          stopRetrying();
          return;
        }

        if (useSessionStatus.getState().getStatus(targetSessionID).type === 'idle') {
          stopRetrying();
          return;
        }

        attemptAbort();
      }, ABORT_RETRY_INTERVAL_MS);

      return targetSessionID;
    },
  });

  return mutation;
};

export const useSendShell = (directory?: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionID,
      command,
    }: {
      sessionID: string;
      command: string;
    }) => {
      return runShell(sessionID, command);
    },
    onSuccess: (_data, variables) => {
      const { sessionID } = variables;

      queryClient.invalidateQueries({
        queryKey: sessionQueryKey(sessionID, directory),
      });
    },
  });
};

export const useAgents = (directory?: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ["opencode", "agents", directory],
    queryFn: () => listAgents(directory),
    enabled: options?.enabled ?? true,
  });
};

export const useSkills = (directory?: string, options?: { enabled?: boolean }) => {
  return useQuery({
    queryKey: ["opencode", "skills", directory],
    queryFn: () => listSkills(directory),
    enabled: options?.enabled ?? true,
  });
};

export const useLoadSkill = (sessionID: string | undefined) => {
  return useMutation<void, Error, { skillName: string }>({
    mutationFn: async ({ skillName }: { skillName: string }) => {
      if (!sessionID) throw new Error("No active session");

      return activateSkill(sessionID, skillName);
    },
    onError: (error) => {
      showToast.error(error instanceof Error ? error.message : "Failed to load skill");
    },
  });
};
