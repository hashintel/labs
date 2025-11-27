import { createFileRoute } from '@tanstack/react-router'
import { convertToModelMessages, stepCountIs, streamText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

import { haiku } from '@/lib/openrouter'
import getTools from '@/utils/demo.tools'

function getModel(request: Request) {
  const clientKey = request.headers.get('x-openrouter-key')
  if (clientKey) {
    const openrouter = createOpenRouter({ apiKey: clientKey })
    return openrouter('anthropic/claude-3.5-haiku')
  }
  return haiku // fallback to server-configured key
}

const SYSTEM_PROMPT = `You are a helpful assistant for a store that sells guitars.

You can use the following tools to help the user:

- getGuitars: Get all guitars from the database
- recommendGuitar: Recommend a guitar to the user
`

export const Route = createFileRoute('/demo/api/tanchat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { messages } = await request.json()

          const tools = await getTools()

          const result = await streamText({
            model: getModel(request),
            messages: convertToModelMessages(messages),
            temperature: 0.7,
            stopWhen: stepCountIs(5),
            system: SYSTEM_PROMPT,
            tools,
          })

          return result.toUIMessageStreamResponse()
        } catch (error) {
          console.error('Chat API error:', error)
          return new Response(
            JSON.stringify({ error: 'Failed to process chat request' }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
      },
    },
  },
})
