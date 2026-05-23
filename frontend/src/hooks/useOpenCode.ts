import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { useSessionStatus } from "../stores/sessionStatusStore";
import { useSendErrorStore } from "../stores/sendErrorStore";

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

export const useSessions = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "sessions", opcodeUrl, directory],
    queryFn: () => client!.listSessions(),
    enabled: !!client,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 10000,
  });
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
    queryKey: ["opencode", "messages", opcodeUrl, sessionID, directory],
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
      queryClient.invalidateQueries({ queryKey: ["opencode", "sessions", opcodeUrl, directory] });
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

export const useDeleteSession = (opcodeUrl: string | null | undefined, directory?: string) => {
  const queryClient = useQueryClient();
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useMutation({
    mutationFn: async (sessionIDs: string | string[]) => {
      if (!client) {
        throw new Error('OpenCode client not available');
      }
      
      const ids = Array.isArray(sessionIDs) ? sessionIDs : [sessionIDs]
      
      const deletePromises = ids.map(async (sessionID) => {
        await client.deleteSession(sessionID);
      })
      
      const results = await Promise.allSettled(deletePromises)
      const failures = results.filter(result => result.status === 'rejected')
      
      if (failures.length > 0) {
        throw new Error(`Failed to delete ${failures.length} session(s)`)
      }
      
      return results
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["opencode", "sessions", opcodeUrl, directory] });
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
      queryClient.invalidateQueries({ queryKey: ["opencode", "sessions", opcodeUrl, directory] });
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

export const useSendPrompt = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();
  const setSessionStatus = useSessionStatus((state) => state.setStatus);

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

      setSessionStatus(sessionID, { type: "busy" });

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const contentParts = parts || [{ type: "text" as const, content: prompt || "", name: "" }];
      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        contentParts,
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID, model, agent, variant);

      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];
      await queryClient.cancelQueries({ queryKey: messagesQueryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

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
        await client.sendPromptAsync(sessionID, requestData);
        return { optimisticUserID, queued: true };
      }

      const response = await client.sendPrompt(sessionID, requestData);

      return { optimisticUserID, response, queued: false };
    },
    onError: (error, variables) => {
      const { sessionID } = variables;
      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];

      setSessionStatus(sessionID, { type: "idle" });
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
        (old) => old?.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_")),
      );
      
      const isNetworkError = error instanceof TypeError ||
        (error instanceof FetchError && (error.code === 'TIMEOUT' || error.statusCode === 524));

      if (isNetworkError) {
        return;
      }

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
      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];

      useSendErrorStore.getState().clearError(sessionID);

      if (data.queued || !response) {
        queryClient.invalidateQueries({ queryKey: messagesQueryKey });
        return;
      }

      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
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

      setSessionStatus(sessionID, { type: "idle" });
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
    const queryKey = ["opencode", "messages", opcodeUrl, targetSessionID, directory];
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
    const queryKey = ["opencode", "messages", opcodeUrl, targetSessionID, directory];
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
      const queryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];
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
  const setSessionStatus = useSessionStatus((state) => state.setStatus);

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

      setSessionStatus(sessionID, { type: "busy" });

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const userMessageParts = createOptimisticUserMessageParts(
        sessionID,
        [{ type: "text" as const, content: command }],
        optimisticUserID,
      );
      const userMessageInfo = createOptimisticUserMessageInfo(sessionID, optimisticUserID);

      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];
      await queryClient.cancelQueries({ queryKey: messagesQueryKey });

      const optimisticMessageWithParts: MessageWithParts = {
        info: userMessageInfo,
        parts: userMessageParts,
      }
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
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
      setSessionStatus(sessionID, { type: "idle" });
      queryClient.setQueryData<MessageWithParts[]>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => {
          if (!old) return old;
          return old.filter((msgWithParts) => !msgWithParts.info.id.startsWith("optimistic_"));
        },
      );

      setSessionStatus(sessionID!, { type: "idle" });
    },
    onSuccess: (data, variables) => {
      const { sessionID } = variables;
      const { optimisticUserID } = data;

      queryClient.setQueryData<MessageWithParts[]>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
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
  const setSessionStatus = useSessionStatus((state) => state.setStatus);

  return useMutation<
    { optimisticUserID: string; response: SendCommandResponse },
    Error,
    { skillName: string }
  >({
    mutationFn: async ({ skillName }: { skillName: string }) => {
      if (!client) throw new Error("No OpenCode client available");
      if (!sessionID) throw new Error("No active session");

      setSessionStatus(sessionID, { type: "busy" });

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;
      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];

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

      await queryClient.cancelQueries({ queryKey: messagesQueryKey });
      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
        (old) => [...(old || []), optimisticMessageWithParts],
      );

      const response = await client.sendCommand(sessionID, { command: skillName, arguments: "" });
      return { optimisticUserID, response };
    },
    onError: (error) => {
      if (sessionID) {
        const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];
        setSessionStatus(sessionID!, { type: "idle" });
        queryClient.setQueryData<MessageWithParts[]>(
          messagesQueryKey,
          (old) => old?.filter((m) => !m.info.id.startsWith("optimistic_")),
        );
      }
      showToast.error(error instanceof Error ? error.message : "Failed to load skill");
    },
    onSuccess: (data) => {
      const { response } = data;
      const messagesQueryKey = ["opencode", "messages", opcodeUrl, sessionID, directory];

      queryClient.setQueryData<MessageWithParts[]>(
        messagesQueryKey,
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

      setSessionStatus(sessionID!, { type: "idle" });
    },
  });
};
