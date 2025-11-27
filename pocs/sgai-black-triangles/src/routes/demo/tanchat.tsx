import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Send } from 'lucide-react'
import { Streamdown } from 'streamdown'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

import type { UIMessage } from 'ai'

import GuitarRecommendation from '@/components/example-GuitarRecommendation'
import { getStoredApiKey } from '@/routes/demo/config'

import './tanchat.css'

function InitalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="mx-auto w-full max-w-3xl text-center">
        <h1 className="mb-4 bg-linear-to-r from-orange-500 to-red-600 bg-clip-text text-6xl font-bold text-transparent uppercase">
          <span className="text-white">TanStack</span> Chat
        </h1>
        <p className="mx-auto mb-6 w-2/3 text-lg text-gray-400">
          You can ask me about anything, I might or might not have a good
          answer, but you can still ask.
        </p>
        {children}
      </div>
    </div>
  )
}

function ChattingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky right-0 bottom-0 left-0 z-10 border-t border-orange-500/10 bg-gray-900/80 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-3xl px-4 py-3">{children}</div>
    </div>
  )
}

function Messages({ messages }: { messages: Array<UIMessage> }) {
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight
    }
  }, [messages])

  if (!messages.length) {
    return null
  }

  return (
    <div
      ref={messagesContainerRef}
      className="min-h-0 flex-1 overflow-y-auto pb-4"
    >
      <div className="mx-auto w-full max-w-3xl px-4">
        {messages.map(({ id, role, parts }) => (
          <div
            key={id}
            className={`p-4 ${
              role === 'assistant'
                ? 'bg-gradient-to-r from-orange-500/5 to-red-600/5'
                : 'bg-transparent'
            }`}
          >
            <div className="mx-auto flex w-full max-w-3xl items-start gap-4">
              {role === 'assistant' ? (
                <div className="mt-2 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-linear-to-r from-orange-500 to-red-600 text-sm font-medium text-white">
                  AI
                </div>
              ) : (
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-700 text-sm font-medium text-white">
                  Y
                </div>
              )}
              <div className="flex-1">
                {parts.map((part, index) => {
                  if (part.type === 'text') {
                    return (
                      <div
                        className="prose dark:prose-invert prose-sm max-w-none min-w-0 flex-1"
                        key={index}
                      >
                        <Streamdown>{part.text}</Streamdown>
                      </div>
                    )
                  }
                  if (
                    part.type === 'tool-recommendGuitar' &&
                    part.state === 'output-available' &&
                    (part.output as { id: string })?.id
                  ) {
                    return (
                      <div key={index} className="mx-auto max-w-[80%]">
                        <GuitarRecommendation
                          id={(part.output as { id: string })?.id}
                        />
                      </div>
                    )
                  }
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatPage() {
  const [apiKey] = useState<string | null>(() => getStoredApiKey())

  const transport = useMemo(() => {
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers['x-openrouter-key'] = apiKey
    }
    return new DefaultChatTransport({
      api: '/demo/api/tanchat',
      headers,
    })
  }, [apiKey])

  const { messages, sendMessage } = useChat({ transport })
  const [input, setInput] = useState('')

  const Layout = messages.length ? ChattingLayout : InitalLayout

  return (
    <div className="relative flex h-[calc(100vh-80px)] bg-gray-900">
      <div className="flex min-h-0 flex-1 flex-col">
        <Messages messages={messages} />

        <Layout>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendMessage({ text: input })
              setInput('')
            }}
          >
            <div className="relative mx-auto max-w-xl">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type something clever..."
                className="w-full resize-none overflow-hidden rounded-lg border border-orange-500/20 bg-gray-800/50 py-3 pr-12 pl-4 text-sm text-white placeholder-gray-400 shadow-lg focus:border-transparent focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
                rows={1}
                style={{ minHeight: '44px', maxHeight: '200px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height =
                    Math.min(target.scrollHeight, 200) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage({ text: input })
                    setInput('')
                  }
                }}
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute top-1/2 right-2 -translate-y-1/2 p-2 text-orange-500 transition-colors hover:text-orange-400 focus:outline-none disabled:text-gray-500"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </Layout>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/demo/tanchat')({
  component: ChatPage,
})
