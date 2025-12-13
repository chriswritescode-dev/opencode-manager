import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useEffect, useCallback } from "react";
import { OpenCodeClient } from "../api/opencode";
import type {
  MessageWithParts,
  MessageListResponse,
  ContentPart,
} from "../api/types";
import type { paths, components } from "../api/opencode-types";

type AssistantMessage = components["schemas"]["AssistantMessage"];

type SendPromptRequest = NonNullable<
  paths["/session/{id}/message"]["post"]["requestBody"]
>["content"]["application/json"];

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

export const useMessages = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "messages", opcodeUrl, sessionID, directory],
    queryFn: () => client!.listMessages(sessionID!),
    enabled: !!client && !!sessionID,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 30000,
    gcTime: 10 * 60 * 1000,
    placeholderData: (previousData) => previousData,
  });
};

export const useCreateSession = (opcodeUrl: string | null | undefined, directory?: string) => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opencode", "sessions", opcodeUrl, directory] });
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
    onSuccess: () => {
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

const createOptimisticUserMessage = (
  sessionID: string,
  parts: ContentPart[],
  optimisticID: string,
): MessageWithParts => {
  const messageParts = parts.map((part, index) => {
    if (part.type === "text") {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "text" as const,
        text: part.content,
        messageID: optimisticID,
        sessionID,
      };
    } else {
      return {
        id: `${optimisticID}_part_${index}`,
        type: "file" as const,
        filename: part.name,
        url: part.path,
        messageID: optimisticID,
        sessionID,
      };
    }
  });

  return {
    info: {
      id: optimisticID,
      role: "user",
      sessionID,
      time: { created: Date.now() },
    },
    parts: messageParts,
  } as MessageWithParts;
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
    }: {
      sessionID: string;
      prompt?: string;
      parts?: ContentPart[];
      model?: string;
      agent?: string;
    }) => {
      if (!client) throw new Error("No client available");

      const optimisticUserID = `optimistic_user_${Date.now()}_${Math.random()}`;

      const contentParts = parts || [{ type: "text" as const, content: prompt || "", name: "" }];

      const userMessage = createOptimisticUserMessage(
        sessionID,
        contentParts,
        optimisticUserID,
      );
      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => [...(old || []), userMessage],
      );

      const requestData: SendPromptRequest = {
        parts: parts?.map((part) =>
          part.type === "text"
            ? { type: "text", text: part.content }
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
        const [providerID, modelID] = model.split("/");
        if (providerID && modelID) {
          requestData.model = {
            providerID,
            modelID,
          };
        }
      }

      if (agent) {
        requestData.agent = agent;
      }

      const response = await client.sendPrompt(sessionID, requestData);

      return { optimisticUserID, response };
    },
    onError: (_, variables) => {
      const { sessionID } = variables;
      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => old?.filter((msg) => !msg.info.id.startsWith("optimistic_")),
      );
    },
    onSuccess: (data, variables) => {
      const { sessionID } = variables;
      const { optimisticUserID } = data;

      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => old?.filter((msg) => msg.info.id !== optimisticUserID) || [],
      );

      queryClient.invalidateQueries({
        queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
      });
    },
  });
};

const ABORT_RETRY_INTERVAL_MS = 3000;
const MAX_ABORT_RETRIES = 10;

export const useAbortSession = (
  opcodeUrl: string | null | undefined,
  directory?: string,
  sessionID?: string
) => {
  const client = useOpenCodeClient(opcodeUrl, directory);
  const queryClient = useQueryClient();
  const retryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef(0);

  const forceCompleteMessages = useCallback((targetSessionID: string) => {
    const queryKey = ["opencode", "messages", opcodeUrl, targetSessionID, directory];
    
    queryClient.setQueryData<MessageListResponse>(queryKey, (old) => {
      if (!old) return old;
      
      return old.map(msg => {
        if (msg.info.role === "assistant") {
          const assistantInfo = msg.info as AssistantMessage;
          if (!assistantInfo.time.completed) {
            return {
              ...msg,
              info: {
                ...assistantInfo,
                time: {
                  ...assistantInfo.time,
                  completed: Date.now()
                },
                error: {
                  name: "MessageAbortedError" as const,
                  data: { message: "Session aborted" }
                }
              }
            };
          }
        }
        return msg;
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
    const messages = queryClient.getQueryData<MessageListResponse>(queryKey);
    
    const hasActiveStream = messages?.some(msg => {
      if (msg.info.role !== "assistant") return false;
      const assistantInfo = msg.info as AssistantMessage;
      return !assistantInfo.time.completed;
    });

    return !hasActiveStream;
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

      const userMessage = createOptimisticUserMessage(
        sessionID,
        [{ type: "text" as const, content: command }],
        optimisticUserID,
      );
      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => [...(old || []), userMessage],
      );

      const response = await client.sendShell(sessionID, {
        command,
        agent: agent || "general",
      });

      return { optimisticUserID, response };
    },
    onError: (_, variables) => {
      const { sessionID } = variables;
      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => old?.filter((msg) => !msg.info.id.startsWith("optimistic_")),
      );
    },
    onSuccess: (data, variables) => {
      const { sessionID } = variables;
      const { optimisticUserID } = data;

      queryClient.setQueryData<MessageListResponse>(
        ["opencode", "messages", opcodeUrl, sessionID, directory],
        (old) => old?.filter((msg) => msg.info.id !== optimisticUserID) || [],
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
