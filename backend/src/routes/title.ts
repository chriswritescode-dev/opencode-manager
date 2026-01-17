import { Hono } from 'hono'
import { z } from 'zod'
import { logger } from '../utils/logger'
import { ENV } from '@opencode-manager/shared/config/env'

const TitleRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  sessionID: z.string().min(1)
})

const OPENCODE_SERVER_URL = `http://127.0.0.1:${ENV.OPENCODE.PORT}`

function buildUrl(path: string, directory?: string): string {
  const url = `${OPENCODE_SERVER_URL}${path}`
  return directory ? `${url}${url.includes('?') ? '&' : '?'}directory=${encodeURIComponent(directory)}` : url
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

      const configResponse = await fetch(buildUrl('/config', directory))
      if (!configResponse.ok) {
        logger.error('Failed to fetch OpenCode config')
        return c.json({ error: 'Failed to fetch config' }, 500)
      }
      const config = await configResponse.json() as { model?: string; small_model?: string }

      const modelStr = config.small_model || (config.model ?? "")
      const [providerID, modelID] = modelStr.split('/')

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
            model: { providerID, modelID }
          })
        })

        if (!promptResponse.ok) {
          const errorText = await promptResponse.text()
          logger.error('Failed to generate title via LLM', { error: errorText })
          return c.json({ error: 'LLM request failed' }, 500)
        }

        const result = await promptResponse.json() as { parts?: Array<{ type: string; text?: string }> }
        
        let title = ''
        if (result.parts) {
          const textPart = result.parts.find((p: { type: string }) => p.type === 'text')
          if (textPart && 'text' in textPart) {
            title = (textPart.text as string)
              .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
              .split('\n')
              .map((line: string) => line.trim())
              .find((line: string) => line.length > 0) || ''
          }
        }

        if (title && title.length > 100) {
          title = title.substring(0, 97) + '...'
        }

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
