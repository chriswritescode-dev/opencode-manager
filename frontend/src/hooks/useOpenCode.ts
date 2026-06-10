import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { OpenCodeClient } from "../api/opencode";
import { FetchError } from "../api/fetchWrapper";
import type {
  Message,
  Part,
  ContentPart,
  MessageWithParts,
} from "../api/types";
import type { paths, components } from "../api/opencode-types";
import { parseNetworkError } from "../lib/opencode-errors";
import { showToast } from "../lib/toast";
import { useSendErrorStore } from "../stores/sendErrorStore";
import { useSessionStatus } from "../stores/sessionStatusStore";
import { invalidateSessionListCaches, messagesQueryKey } from "../lib/queryInvalidation";

type AssistantMessage = components["schemas"]["AssistantMessage"];

type SendPromptRequest = NonNullable<
  paths["/session/{sessionID}/message"]["post"]["requestBody"]
>["content"]["application/json"];

type SendCommandResponse = paths["/session/{sessionID}/command"]["post"]["responses"]["200"]["content"]["application/json"];

const parseModelString = (model: string) => {
  const [providerID, ...rest] = model.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
};

export const useOpenCodeClient = (opcodeUrl: string | null | undefined, directory?: string) => {
  return useMemo(
    () => (opcodeUrl ? new OpenCodeClient(opcodeUrl, directory) : null),
    [opcodeUrl, directory],
  );
};

const SESSION_LIST_PAGE_SIZE = 25

interface UseSessionsAcrossDirectoriesOptions {
  search?: string
  limit?: number
}

type SessionPageParam = Record<string, string>

export const useSessionsAcrossDirectories = (
  opcodeUrl: string | null | undefined,
  directories: string[],
  options?: UseSessionsAcrossDirectoriesOptions,
) => {
  const uniqueDirectories = useMemo(
    () => Array.from(new Set(directories.filter(Boolean))),
    [directories],
  );
  const normalizedSearch = options?.search?.trim() || undefined;
  const limit = options?.limit ?? SESSION_LIST_PAGE_SIZE;
  const directoryKey = uniqueDirectories.join('|');

  const query = useInfiniteQuery({
    queryKey: ['opencode', 'sessions', opcodeUrl, directoryKey, { search: normalizedSearch, limit }],
    queryFn: async ({ pageParam }) => {
      if (!pageParam) {
        const pages = await Promise.all(
          uniqueDirectories.map((directory) =>
            new OpenCodeClient(opcodeUrl!, directory).listSessionsPage({
              limit,
              order: 'desc',
              search: normalizedSearch,
            }),
          ),
        );
        const cursors: SessionPageParam = {};
        const items: Array<components['schemas']['Session']> = [];
        for (let i = 0; i < pages.length; i++) {
          items.push(...pages[i].items);
          if (pages[i].nextCursor) {
            cursors[uniqueDirectories[i]] = pages[i].nextCursor!;
          }
        }
        return { items, cursors };
      }

      const entries = Object.entries(pageParam);
      const pages = await Promise.all(
        entries.map(([directory, cursor]) =>
          new OpenCodeClient(opcodeUrl!, directory).listSessionsPage({ cursor }),
        ),
      );
      const cursors: SessionPageParam = {};
      const items: Array<components['schemas']['Session']> = [];
      for (let i = 0; i < pages.length; i++) {
        items.push(...pages[i].items);
        if (pages[i].nextCursor) {
          cursors[entries[i][0]] = pages[i].nextCursor!;
        }
      }
      return { items, cursors };
    },
    initialPageParam: undefined as SessionPageParam | undefined,
    getNextPageParam: (lastPage) => {
      if (Object.keys(lastPage.cursors).length > 0) {
        return lastPage.cursors;
      }
      return undefined;
    },
    enabled: !!opcodeUrl && uniqueDirectories.length > 0,
    staleTime: 10000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    data: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    error: query.error,
  };
};

export const useSession = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
    queryFn: () => client!.getSession(sessionID!),
    enabled: !!client && !!sessionID,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 15000,
  });
};

export const useMessages = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string, opts?: { fallbackPoll?: boolean }) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: messagesQueryKey(opcodeUrl, sessionID, directory),
    queryFn: async () => {
      const response = await client!.listMessages(sessionID!)
      return response as MessageWithParts[]
    },
    enabled: !!client && !!sessionID,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 30000,
    gcTime: 10 * 60 * 1000,
    refetchInterval: opts?.fallbackPoll ? 5000 : undefined,
  });
};

export const useCreateSession = (
  opcodeUrl: string | null | undefined,
  directory?: string,
  onSuccess?: (session: { id: string }) => void,
) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      title?: string;
      agent?: string;
      model?: string;
    }) => {
      if (!client) throw new Error("No client available");
      return client.createSession(data);
    },
    onSuccess: (session) => {
      invalidateSessionListCaches(queryClient, opcodeUrl);
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

export type DeleteSessionTarget = string | { id: string; directory?: string; workspaceID?: string };

const getDeleteSessionTargetId = (target: DeleteSessionTarget) =>
  typeof target === 'string' ? target : target.id;

const getDeleteSessionTargetDirectory = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  typeof target === 'string' ? fallbackDirectory : target.directory ?? fallbackDirectory;

const getDeleteSessionTargetWorkspaceID = (target: DeleteSessionTarget) =>
  typeof target === 'string' ? undefined : target.workspaceID;

const getDeleteSessionTargetKey = (target: DeleteSessionTarget, fallbackDirectory?: string) =>
  `${getDeleteSessionTargetDirectory(target, fallbackDirectory) ?? ''}:${getDeleteSessionTargetId(target)}`;

const isMissingWorkspaceError = (error: unknown) =>
  error instanceof Error && error.message.includes('Workspace not found:');

const shouldDeleteWorkspaceForSessionDeleteError = (error: unknown) =>
  isMissingWorkspaceError(error) ||
  (error instanceof FetchError &&
    error.statusCode === 500 &&
    (error.message.includes('Unexpected server error') || error.message === 'Request failed'));

export const useDeleteSession = (opcodeUrl: string | null | undefined, directory?: string | string[]) => {
  const queryClient = useQueryClient();
  const directories = useMemo(
    () => (Array.isArray(directory) ? directory : directory ? [directory] : []),
    [directory],
  );
  const primaryDirectory = directories[0];

  return useMutation({
    mutationFn: async (sessionIDs: DeleteSessionTarget | DeleteSessionTarget[]) => {
      if (!opcodeUrl) {
        throw new Error('OpenCode client not available');
      }
      
      const targets = Array.from(
        new Map(
          (Array.isArray(sessionIDs) ? sessionIDs : [sessionIDs]).map((target) => [
            getDeleteSessionTargetKey(target, primaryDirectory),
            target,
          ]),
        ).values(),
      )
      
      const results: PromiseSettledResult<void>[] = []
      const removedWorkspaces = new Set<string>()
      for (const target of targets) {
        const workspaceID = getDeleteSessionTargetWorkspaceID(target)
        if (workspaceID && removedWorkspaces.has(workspaceID)) {
          results.push({ status: 'fulfilled', value: undefined })
          continue
        }

        const client = new OpenCodeClient(
          opcodeUrl,
          getDeleteSessionTargetDirectory(target, primaryDirectory),
        )
        try {
          await client.deleteSession(getDeleteSessionTargetId(target))
          results.push({ status: 'fulfilled', value: undefined })
        } catch (reason) {
          if (workspaceID && shouldDeleteWorkspaceForSessionDeleteError(reason)) {
            try {
              await client.deleteWorkspace(workspaceID)
              removedWorkspaces.add(workspaceID)
              results.push({ status: 'fulfilled', value: undefined })
              continue
            } catch (workspaceReason) {
              results.push({ status: 'rejected', reason: workspaceReason })
              continue
            }
          }
          results.push({ status: 'rejected', reason })
        }
      }
      const failures = results.filter(result => result.status === 'rejected')
      
      if (failures.length > 0) {
        throw new Error(`Failed to delete ${failures.length} session(s)`)
      }
      
      return { deleted: targets.length, results }
    },
    onSuccess: ({ deleted }) => {
      showToast.success(deleted === 1 ? 'Session deleted' : `${deleted} sessions deleted`);
    },
    onError: () => {
      showToast.error('Failed to delete sessions');
    },
    onSettled: () => {
      invalidateSessionListCaches(queryClient, opcodeUrl);
    },
  });
};

export const useUpdateSession = (opcodeUrl: string | null | undefined, directory?: string) => {
  const queryClient = useQueryClient();
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useMutation({
    mutationFn: async ({ sessionID, title }: { sessionID: string; title: string }) => {
      if (!client) throw new Error("No client available");
      return client.updateSession(sessionID, { title });
    },
    onSuccess: (_, variables) => {
      const { sessionID } = variables;
      queryClient.invalidateQueries({ queryKey: ["opencode", "session", opcodeUrl, sessionID, directory] });
      invalidateSessionListCaches(queryClient, opcodeUrl);
    },
  });
};

const createOptimisticUserMessageParts = (
  sessionID: string,
  parts: ContentPart[],
  optimisticID: string,
) => {
  return parts.map((part, index): Part => {
    if (part.type === "text") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "text" as const,
        text: part.content,
        messageID: optimisticID,
        sessionID,
      } as Part;
    } else if (part.type === "image") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file" as const,
        filename: part.filename,
        url: part.dataUrl,
        mime: part.mime || "image/*",
        messageID: optimisticID,
        sessionID,
      } as Part;
    } else {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file" as const,
        filename: part.name,
        url: part.path.startsWith("file:") ? part.path : `file://${part.path}`,
        mime: "text/plain",
        messageID: optimisticID,
        sessionID,
      } as Part;
    }
  });
};

const createOptimisticUserMessageInfo = (
  sessionID: string,
  optimisticID: string,
  model?: string,
  agent?: string,
  variant?: string,
): Message => {
  const message = {
    id: optimisticID,
    role: "user",
    sessionID,
    time: { created: Date.now() },
  } as Message;

  if (model) {
    const parsedModel = parseModelString(model);
    if (parsedModel) {
      return {
        ...message,
        model: parsedModel,
        agent,
        variant,
      } as Message;
    }
  }

  return { ...message, agent, variant } as Message;
};

const getPromptText = (prompt: string | undefined, parts: ContentPart[] | undefined): string => {
  if (prompt !== undefined) return prompt;
  if (!parts) return "";
  return parts
    .filter((part): part is ContentPart & { type: "text" } => part.type === "text")
    .map((part) => part.content)
    .join("")
    .trim();
};

export const useSendPrompt = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionID,
      prompt,
      parts,
      model,
      agent,
      variant,
      queued,
    }: {
      sessionID: string;
      prompt?: string;
      parts?: ContentPart[];
      model?: string;
      agent?: string;
      variant?: string;
      queued?: boolean;
    }) => {
      if (!client) throw new Error("No client available");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const contentParts = parts || [{ type: "text" as const, content: prompt || "", name: "" }];
      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        contentParts,
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID, model, agent, variant);

      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      await queryClient.cancelQueries({ queryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );
      useSessionStatus.getState().setOptimisticActive(sessionID);

      const requestData: SendPromptRequest = {
        parts: parts?.map((part) =>
          part.type === "text"
            ? { type: "text", text: (part as ContentPart & { type: "text" }).content }
            : part.type === "image"
              ? {
                  type: "file",
                  mime: part.mime,
                  filename: part.filename,
                  url: part.dataUrl,
                }
              : {
                  type: "file",
                  mime: "text/plain",
                  filename: part.name,
                  url: part.path.startsWith("file:")
                    ? part.path
                    : `file://${part.path}`,
                },
        ) || [{ type: "text", text: prompt || "" }],
      };

      if (model) {
        const parsedModel = parseModelString(model);
        if (parsedModel) {
          const cachedProviders = queryClient.getQueryData<{
            providers: Array<{ id: string; models: Record<string, unknown> }>;
          }>(['opencode', 'providers', opcodeUrl, directory]);
          if (cachedProviders?.providers) {
            const provider = cachedProviders.providers.find(
              (p) => p.id === parsedModel.providerID,
            );
            if (!provider || !(parsedModel.modelID in provider.models)) {
              throw new FetchError(
                'Selected model is no longer available. Pick a different model.',
                409,
                'MODEL_UNAVAILABLE',
              );
            }
          }

          requestData.model = {
            providerID: parsedModel.providerID,
            modelID: parsedModel.modelID,
          };
        }
      }

      if (agent) {
        requestData.agent = agent;
      }

      if (variant) {
        requestData.variant = variant;
      }

      if (queued) {
        useSendErrorStore.getState().setQueuedPrompt(sessionID, getPromptText(prompt, parts));

        try {
          await client.sendPromptAsync(sessionID, requestData);
        } catch (error) {
          useSendErrorStore.getState().clearQueuedPrompt(sessionID);
          throw error;
        }

        return { optimisticUserID, queued: true };
      }

      const response = await client.sendPrompt(sessionID, requestData);

      return { optimisticUserID, response, queued: false };
    },
    onError: (error, variables) => {
      const { sessionID, queued } = variables;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      if (queued) {
        useSendErrorStore.getState().clearQueuedPrompt(sessionID);
      }

      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => old?.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_")),
      );
      
      const isNetworkError = error instanceof TypeError ||
        (error instanceof FetchError && (error.code === 'TIMEOUT' || error.statusCode === 524));

      if (isNetworkError) {
        return;
      }

      useSessionStatus.getState().clearStatus(sessionID);

      const parsed = parseNetworkError(error);
      useSendErrorStore.getState().setError({
        sessionID,
        title: parsed.title,
        message: parsed.message,
        detail: error instanceof FetchError ? error.detail : undefined,
      });
    },
    onSuccess: async (data, variables) => {
      const { sessionID } = variables;
      const { response } = data;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      useSendErrorStore.getState().clearError(sessionID);

      if (data.queued || !response) {
        queryClient.invalidateQueries({ queryKey });
        return;
      }

      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => {
          if (!old) return old;

          const existingIdx = old.findIndex(m => m.info.id === response.info.id);
          if (existingIdx >= 0) {
            const updated = [...old];
            updated[existingIdx] = { info: response.info, parts: response.parts };
            return updated;
          }

          return [...old, { info: response.info, parts: response.parts }];
        },
      );

    },
  });
};

const ABORT_RETRY_INTERVAL_MS = 3000;
const MAX_ABORT_RETRIES = 10;

export const useAbortSession = (
  opcodeUrl: string | null | undefined,
  directory?: string,
  sessionID?: string,
) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const forceCompleteMessages = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(opcodeUrl, targetSessionID, directory);
    const now = Date.now();
    
    queryClient.setQueryData<MessageWithParts[]>(queryKey, (old) => {
      if (!old) return old;
      
      return old.map(msgWithParts => {
        const msg = msgWithParts.info;
        let updatedParts = msgWithParts.parts;
        
        if (msg.role === "assistant") {
          const assistantInfo = msg as AssistantMessage;
          if (!assistantInfo.time.completed) {
            updatedParts = updatedParts.map(part => {
              if (part.type !== "tool") return part;
              if (part.state.status !== "running" && part.state.status !== "pending") return part;
              return {
                ...part,
                state: {
                  ...part.state,
                  status: "completed" as const,
                  output: part.state.status === "running" ? "[Session aborted]" : "[Tool was pending when session aborted]",
                  title: part.state.status === "running" ? (part.state as { title?: string }).title || "" : "",
                  metadata: (part.state as { metadata?: Record<string, unknown> }).metadata || {},
                  time: {
                    start: (part.state as { time?: { start: number } }).time?.start || now,
                    end: now
                  }
                }
              };
            });
            
            return {
              ...msgWithParts,
              info: {
                ...assistantInfo,
                time: {
                  ...assistantInfo.time,
                  completed: now
                },
                error: {
                  name: "MessageAbortedError" as const,
                  data: { message: "Session aborted" }
                }
              },
              parts: updatedParts
            };
          }
        }
        return msgWithParts;
      });
    });
  }, [queryClient, opcodeUrl, directory]);

  const stopRetrying = useCallback(() => {
    if (retryIntervalRef.current) {
      clearInterval(retryIntervalRef.current);
      retryIntervalRef.current = null;
    }
    retryCountRef.current = 0;
  }, []);

  const isSessionComplete = useCallback((targetSessionID: string) => {
    const queryKey = messagesQueryKey(opcodeUrl, targetSessionID, directory);
    const messages = queryClient.getQueryData<MessageWithParts[]>(queryKey);
    
    const hasIncompleteMessages = messages?.some(msgWithParts => {
      if (msgWithParts.info.role !== "assistant") return false;
      const assistantInfo = msgWithParts.info as AssistantMessage;
      return !assistantInfo.time.completed;
    });

    return !hasIncompleteMessages;
  }, [queryClient, opcodeUrl, directory]);

  useEffect(() => {
    if (!sessionID) return;

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      if (event.query.queryKey.join(",") === queryKey.join(",")) {
        if (isSessionComplete(sessionID) && retryIntervalRef.current) {
          stopRetrying();
        }
      }
    });

    return () => unsubscribe();
  }, [sessionID, queryClient, opcodeUrl, directory, isSessionComplete, stopRetrying]);

  useEffect(() => {
    return () => stopRetrying();
  }, [stopRetrying]);

  const mutation = useMutation({
    mutationFn: async (targetSessionID: string) => {
      if (!client) throw new Error("No client available");
      
      stopRetrying();
      forceCompleteMessages(targetSessionID);

      const attemptAbort = async () => {
        try {
          await client.abortSession(targetSessionID);
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

        if (isSessionComplete(targetSessionID)) {
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

export const useSendShell = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionID,
      command,
      agent,
    }: {
      sessionID: string;
      command: string;
      agent?: string;
    }) => {
      if (!client) throw new Error("No client available");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        [{ type: "text" as const, content: command }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);

      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
      await queryClient.cancelQueries({ queryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await client.sendShell(sessionID, {
        command,
        agent: agent || "general",
      });

      return { optimisticUserID, response };
    },
    onError: (_, variables) => {
      const { sessionID } = variables;
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(opcodeUrl, sessionID, directory),
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_"));
        },
      );
    },
    onSuccess: (data, variables) => {
      const { sessionID } = variables;
      const { optimisticUserID } = data;

      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey(opcodeUrl, sessionID, directory),
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => msgWithParts.info.id !== optimisticUserID);
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
      });
    },
  });
};

export const useConfig = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "config", opcodeUrl, directory],
    queryFn: () => client!.getConfig(),
    enabled: !!client,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
};

export const useAgents = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "agents", opcodeUrl, directory],
    queryFn: () => client!.listAgents(),
    enabled: !!client,
  });
};

export const useLoadSkill = (
  opcodeUrl: string | null | undefined,
  sessionID: string | undefined,
  directory?: string,
) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();

  return useMutation<
    { optimisticUserID: string; response: SendCommandResponse },
    Error,
    { skillName: string }
  >({
    mutationFn: async ({ skillName }: { skillName: string }) => {
      if (!client) throw new Error("No OpenCode client available");
      if (!sessionID) throw new Error("No active session");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        [{ type: "text" as const, content: `Loading skill: ${skillName}` }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);
      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      };

      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await client.sendCommand(sessionID, { command: skillName, arguments: "" });
      return { optimisticUserID, response };
    },
    onError: (error) => {
      if (sessionID) {
        const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);
        queryClient.setQueryData<MessageWithParts[]>(
          queryKey,
          (old) => old?.filter((m) => !m.info.id.startsWith("optimistic_")),
        );
      }
      showToast.error(error instanceof Error ? error.message : "Failed to load skill");
    },
    onSuccess: (data) => {
      const { response } = data;
      const queryKey = messagesQueryKey(opcodeUrl, sessionID, directory);

      queryClient.setQueryData<MessageWithParts[]>(
        queryKey,
        (old) => {
          if (!old) return old;

          const existingIdx = old.findIndex(m => m.info.id === response.info.id);
          if (existingIdx >= 0) {
            const updated = [...old];
            updated[existingIdx] = { info: response.info, parts: response.parts };
            return updated;
          }

          return [...old, { info: response.info, parts: response.parts }];
        },
      );
    },
  });
};
