import { z } from "zod";

export const SSESubscribeSchema = z.object({
  clientId: z.string().min(1),
  directories: z.array(z.string()),
});

export const SSEVisibilitySchema = z.object({
  clientId: z.string().min(1),
  visible: z.boolean(),
});

export type SSESubscribeRequest = z.infer<typeof SSESubscribeSchema>;
export type SSEVisibilityRequest = z.infer<typeof SSEVisibilitySchema>;
