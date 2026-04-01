import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../utils/logger'
import { resolveOpenCodeModel } from '../services/opencode-models'
import { OPENCODE_SERVER_URL } from '../services/proxy'

const TitleRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  sessionID: z.string().min(1)
})
const TITLE_POLL_INTERVAL_MS = 1_000
const TITLE_POLL_TIMEOUT_MS = 30_000

interface PromptResponse {
  parts?: Array<{ type?: string; text?: string }>
}

interface SessionMessage {
  info?: {
    role?: string
    time?: {
      completed?: number
    }
    error?: {
      name?: string
      data?: {
        message?: string
      }
    }
  }
  parts?: Array<{ type?: string; text?: string }>
}

function buildUrl(path: string, directory?: string): string {
  const url = `${OPENCODE_SERVER_URL}${path}`
  return directory ? `${url}${url.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}` : url
}

function parsePromptResponse(responseText: string): PromptResponse | null {
  if (!responseText.trim()) {
    return null
  }

  try {
    return JSON.parse(responseText) as PromptResponse
  } catch {
    return null
  }
}

function extractText(parts: Array<{ type?: string; text?: string }> | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() ?? '')
    .filter(Boolean)
    .join('\n')
}

function extractTitle(result: PromptResponse | SessionMessage): string {
  const text = extractText(result.parts)
  const title = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) || ''

  if (title.length > 100) {
    return title.substring(0, 97) + '...'
  }

  return title
}

async function waitForTitleResponse(sessionID: string, directory: string): Promise<SessionMessage> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < TITLE_POLL_TIMEOUT_MS) {
    const messagesResponse = await fetch(buildUrl(`/session/${sessionID}/message`, directory))

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text()
      throw new Error(errorText || 'Failed to fetch title generation messages')
    }

    const messages = await messagesResponse.json() as SessionMessage[]
    const assistantMessage = [...messages]
      .reverse()
      .find((message) => message.info?.role === 'assistant')

    if (assistantMessage) {
      const errorText = assistantMessage.info?.error?.data?.message ?? assistantMessage.info?.error?.name
      if (errorText) {
        throw new Error(errorText)
      }

      if (assistantMessage.info?.time?.completed) {
        return assistantMessage
      }
    }

    await Bun.sleep(TITLE_POLL_INTERVAL_MS)
  }

  throw new Error('Timed out waiting for title generation')
}

const TITLE_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- Focus on the main topic or question the user needs to retrieve
- Use -ing verbs for actions (Debugging, Implementing, Analyzing)
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "whats up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → Analyzing app.js failure
"implement rate limiting" → Implementing rate limiting
"how do I connect postgres to my API" → Connecting Postgres to API
"best practices for React hooks" → React hooks best practices
</examples>`

export function createTitleRoutes() {
  const app = new Hono()

  app.post('/', async (c) => {
    try {
      const body = await c.req.json()
      const { text, sessionID } = TitleRequestSchema.parse(body)
      const directory = c.req.header('directory') || ''

      logger.info('Generating session title via LLM', { sessionID, textLength: text.length })

      const model = await resolveOpenCodeModel(directory || undefined, {
        preferSmallModel: true,
      })

      const titleSessionResponse = await fetch(buildUrl('/session', directory), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Title Generation' })
      })

      if (!titleSessionResponse.ok) {
        logger.error('Failed to create title generation session')
        return c.json({ error: 'Failed to create session' }, 500)
      }

      const titleSession = await titleSessionResponse.json() as { id: string }
      const titleSessionID = titleSession.id

      try {
        const promptResponse = await fetch(buildUrl(`/session/${titleSessionID}/message`, directory), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parts: [
              { 
                type: 'text', 
                text: `${TITLE_PROMPT}\n\nGenerate a title for this conversation:\n<user_message>\n${text.substring(0, 2000)}\n</user_message>` 
              }
            ],
            model: {
              providerID: model.providerID,
              modelID: model.modelID,
            }
          })
        })

        if (!promptResponse.ok) {
          const errorText = await promptResponse.text()
          logger.error('Failed to generate title via LLM', { error: errorText })
          return c.json({ error: 'LLM request failed' }, 500)
        }

        const promptBody = await promptResponse.text()
        const promptResult = parsePromptResponse(promptBody)
        const title = extractTitle(promptResult ?? await waitForTitleResponse(titleSessionID, directory))

        if (title) {
          const updateResponse = await fetch(buildUrl(`/session/${sessionID}`, directory), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
          })

          if (!updateResponse.ok) {
            logger.error('Failed to update session title')
          }
        }

        logger.info('Session title generated', { sessionID, title })
        return c.json({ title })

      } finally {
        fetch(buildUrl(`/session/${titleSessionID}`, directory), {
          method: 'DELETE'
        }).catch(() => {})
      }

    } catch (error) {
      logger.error('Failed to generate session title:', error)
      return c.json({ error: error instanceof Error ? error.message : 'Failed to generate title' }, 500)
    }
  })

  return app
}
