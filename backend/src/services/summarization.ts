import { logger } from '../utils/logger'
import type { Database } from 'bun:sqlite'

interface SessionMessage {
  info: {
    id: string
    role: 'user' | 'assistant'
    time: { created: number }
  }
  parts: Array<{
    type: string
    text?: string
    toolName?: string
  }>
}

interface SessionSummary {
  sessionId: string
  summary: string
  generatedAt: number
  messageCount: number
}

const SUMMARY_CACHE = new Map<string, SessionSummary>()
const CACHE_TTL_MS = 5 * 60 * 1000

async function callGeminiFlash(prompt: string, apiKey: string): Promise<string | null> {
  try {
    logger.info('Calling Gemini Flash API...')
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.3
          }
        })
      }
    )

    if (!response.ok) {
      const error = await response.text()
      logger.warn(`Gemini API error: ${response.status} - ${error}`)
      return null
    }

    const data = await response.json()
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text || null
    logger.info(`Gemini response: ${JSON.stringify(data).slice(0, 500)}`)
    return result
  } catch (error) {
    logger.warn('Gemini API call failed:', error)
    return null
  }
}

async function callOpenAIMini(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const error = await response.text()
      logger.warn(`OpenAI API error: ${response.status} - ${error}`)
      return null
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content || null
  } catch (error) {
    logger.warn('OpenAI API call failed:', error)
    return null
  }
}

function extractConversationContext(messages: SessionMessage[]): string {
  const relevantMessages = messages.slice(0, 10)
  
  const context: string[] = []
  
  for (const msg of relevantMessages) {
    const role = msg.info?.role || 'unknown'
    
    for (const part of msg.parts || []) {
      if (part.type === 'text' && part.text) {
        const text = part.text.slice(0, 500)
        context.push(`${role}: ${text}`)
      } else if (part.toolName) {
        context.push(`${role}: [used tool: ${part.toolName}]`)
      }
    }
  }
  
  return context.slice(0, 10).join('\n')
}

function extractFirstUserMessage(messages: SessionMessage[]): string | null {
  for (const msg of messages) {
    if (msg.info?.role === 'user') {
      for (const part of msg.parts || []) {
        if (part.type === 'text' && part.text && part.text.length > 10) {
          return part.text.slice(0, 200).trim()
        }
      }
    }
  }
  return null
}

function generateSimpleSummary(messages: SessionMessage[], sessionTitle: string): string {
  const firstMessage = extractFirstUserMessage(messages)
  if (firstMessage) {
    let summary = firstMessage
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (summary.length > 80) {
      summary = summary.slice(0, 77) + '...'
    }
    return summary
  }
  
  const toolsUsed = new Set<string>()
  for (const msg of messages.slice(0, 20)) {
    for (const part of msg.parts || []) {
      if (part.toolName) {
        toolsUsed.add(part.toolName)
      }
    }
  }
  
  if (toolsUsed.size > 0) {
    const tools = Array.from(toolsUsed).slice(0, 3).join(', ')
    return `Session using: ${tools}`
  }
  
  return sessionTitle || `Session with ${messages.length} messages`
}

function buildSummaryPrompt(conversationContext: string, sessionTitle: string): string {
  return `Summarize what this coding session is working on in ONE short sentence (max 15 words). Focus on the task/goal, not the conversation.

Session title: ${sessionTitle}

Recent conversation:
${conversationContext}

One-sentence summary:`
}

export async function summarizeSession(
  sessionId: string,
  sessionTitle: string,
  messages: SessionMessage[],
  forceRefresh = false
): Promise<string | null> {
  logger.info(`Summarizing session ${sessionId}: ${messages.length} messages, title: ${sessionTitle}`)
  
  const cached = SUMMARY_CACHE.get(sessionId)
  const now = Date.now()
  
  if (!forceRefresh && cached) {
    if (now - cached.generatedAt < CACHE_TTL_MS && cached.messageCount === messages.length) {
      logger.info(`Using cached summary for ${sessionId}`)
      return cached.summary
    }
  }
  
  if (messages.length === 0) {
    logger.info(`No messages for ${sessionId}, using title`)
    return sessionTitle || 'Empty session'
  }
  
  const conversationContext = extractConversationContext(messages)
  logger.info(`Conversation context for ${sessionId}: ${conversationContext.slice(0, 200)}...`)
  
  const prompt = buildSummaryPrompt(conversationContext, sessionTitle)
  
  let summary: string | null = null
  
  const geminiKey = process.env.GEMINI_API_KEY
  logger.info(`Gemini API key present: ${!!geminiKey}`)
  if (geminiKey) {
    summary = await callGeminiFlash(prompt, geminiKey)
    if (summary) {
      logger.info(`Summarized session ${sessionId} using Gemini Flash: ${summary}`)
    }
  }
  
  if (!summary) {
    const openaiKey = process.env.OPENAI_API_KEY
    logger.info(`OpenAI API key present: ${!!openaiKey}`)
    if (openaiKey) {
      summary = await callOpenAIMini(prompt, openaiKey)
      if (summary) {
        logger.info(`Summarized session ${sessionId} using GPT-4o-mini: ${summary}`)
      }
    }
  }
  
  if (!summary) {
    logger.info(`LLM APIs unavailable, using simple summary extraction`)
    summary = generateSimpleSummary(messages, sessionTitle)
    logger.info(`Generated simple summary for ${sessionId}: ${summary}`)
  }
  
  if (summary) {
    summary = summary.trim().replace(/^["']|["']$/g, '')
    
    SUMMARY_CACHE.set(sessionId, {
      sessionId,
      summary,
      generatedAt: now,
      messageCount: messages.length
    })
  }
  
  return summary
}

export async function summarizeSessionFromOpenCode(
  sessionId: string,
  directory: string,
  opencodePort: number
): Promise<string | null> {
  try {
    const sessionUrl = `http://127.0.0.1:${opencodePort}/session/${sessionId}?directory=${encodeURIComponent(directory)}`
    const sessionRes = await fetch(sessionUrl)
    if (!sessionRes.ok) {
      logger.warn(`Failed to fetch session ${sessionId}: ${sessionRes.status}`)
      return null
    }
    const session = await sessionRes.json()
    
    const messagesUrl = `http://127.0.0.1:${opencodePort}/session/${sessionId}/message?directory=${encodeURIComponent(directory)}`
    const messagesRes = await fetch(messagesUrl)
    if (!messagesRes.ok) {
      return session.title || null
    }
    const messages = await messagesRes.json()
    
    return await summarizeSession(sessionId, session.title || '', messages)
  } catch (error) {
    logger.warn(`Error summarizing session ${sessionId}:`, error)
    return null
  }
}

export function clearSummaryCache(sessionId?: string): void {
  if (sessionId) {
    SUMMARY_CACHE.delete(sessionId)
  } else {
    SUMMARY_CACHE.clear()
  }
}

export function getCachedSummary(sessionId: string): string | null {
  const cached = SUMMARY_CACHE.get(sessionId)
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return cached.summary
  }
  return null
}
