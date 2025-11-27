import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { OpenCodeClient } from "../api/opencode";
import type {
  MessageWithParts,
  MessageListResponse,
  ContentPart,
} from "../api/types";
import type { paths } from "../api/opencode-types";

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
  });
};

export const useSession = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "session", opcodeUrl, sessionID, directory],
    queryFn: () => client!.getSession(sessionID!),
    enabled: !!client && !!sessionID,
  });
};

export const useMessages = (opcodeUrl: string | null | undefined, sessionID: string | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useQuery({
    queryKey: ["opencode", "messages", opcodeUrl, sessionID, directory],
    queryFn: () => client!.listMessages(sessionID!),
    enabled: !!client && !!sessionID,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
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

export const useAbortSession = (opcodeUrl: string | null | undefined, directory?: string) => {
  const client = useOpenCodeClient(opcodeUrl, directory);

  return useMutation({
    mutationFn: async (sessionID: string) => {
      if (!client) throw new Error("No client available");
      await client.abortSession(sessionID);
    },
  });
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

export const useConfig = (opcodeUrl: string | null | undefined) => {
  const client = useOpenCodeClient(opcodeUrl);

  return useQuery({
    queryKey: ["opencode", "config", opcodeUrl],
    queryFn: () => client!.getConfig(),
    enabled: !!client,
  });
};
