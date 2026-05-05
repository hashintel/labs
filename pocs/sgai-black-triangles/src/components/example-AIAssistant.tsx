import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { Store } from '@tanstack/store'

import { Send, X, ChevronRight } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

import GuitarRecommendation from './example-GuitarRecommendation'
import { getStoredApiKey } from '@/routes/demo/config'

import type { UIMessage } from 'ai'

export const showAIAssistant = new Store(false)

function Messages({ messages }: { messages: Array<UIMessage> }) {
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight
    }
  }, [messages])

  if (!messages.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
        Ask me anything! I'm here to help.
      </div>
    )
  }

  return (
    <div ref={messagesContainerRef} className="flex-1 overflow-y-auto">
      {messages.map(({ id, role, parts }) => (
        <div
          key={id}
          className={`py-3 ${
            role === 'assistant'
              ? 'bg-linear-to-r from-orange-500/5 to-red-600/5'
              : 'bg-transparent'
          }`}
        >
          {parts.map((part) => {
            if (part.type === 'text') {
              return (
                <div className="flex items-start gap-2 px-4">
                  {role === 'assistant' ? (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-linear-to-r from-orange-500 to-red-600 text-xs font-medium text-white">
                      AI
                    </div>
                  ) : (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gray-700 text-xs font-medium text-white">
                      Y
                    </div>
                  )}
                  <div className="prose dark:prose-invert prose-sm max-w-none min-w-0 flex-1 text-white">
                    <Streamdown>{part.text}</Streamdown>
                  </div>
                </div>
              )
            }
            if (
              part.type === 'tool-recommendGuitar' &&
              part.state === 'output-available' &&
              (part.output as { id: string })?.id
            ) {
              return (
                <div key={id} className="mx-auto max-w-[80%]">
                  <GuitarRecommendation
                    id={(part.output as { id: string })?.id}
                  />
                </div>
              )
            }
          })}
        </div>
      ))}
    </div>
  )
}

function ChatInterface({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState<string | null>(null)

  useEffect(() => {
    void getStoredApiKey().then(setApiKey)
  }, [])

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

  return (
    <div className="absolute bottom-0 left-full ml-2 flex h-[600px] w-[700px] flex-col rounded-lg border border-orange-500/20 bg-gray-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-orange-500/20 p-3">
        <h3 className="font-semibold text-white">AI Assistant</h3>
        <button
          onClick={onClose}
          className="text-gray-400 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <Messages messages={messages} />

      <div className="border-t border-orange-500/20 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void sendMessage({ text: input })
            setInput('')
          }}
        >
          <div className="relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="w-full resize-none overflow-hidden rounded-lg border border-orange-500/20 bg-gray-800/50 py-2 pr-10 pl-3 text-sm text-white placeholder-gray-400 focus:border-transparent focus:ring-2 focus:ring-orange-500/50 focus:outline-none"
              rows={1}
              style={{ minHeight: '36px', maxHeight: '120px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage({ text: input })
                  setInput('')
                }
              }}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="absolute top-1/2 right-2 -translate-y-1/2 p-1.5 text-orange-500 transition-colors hover:text-orange-400 focus:outline-none disabled:text-gray-500"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <>{children}</> : null
}

export default function AIAssistant() {
  const isOpen = useStore(showAIAssistant)

  return (
    <div className="relative z-50">
      <button
        onClick={() => showAIAssistant.setState((state) => !state)}
        className="flex w-full items-center justify-between rounded-lg bg-linear-to-r from-orange-500 to-red-600 px-4 py-2.5 text-white transition-opacity hover:opacity-90"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-lg bg-white/20 text-xs font-medium">
            AI
          </div>
          <span className="font-medium">AI Assistant</span>
        </div>
        <ChevronRight className="h-4 w-4" />
      </button>

      {isOpen && (
        <ClientOnly>
          <ChatInterface
            onClose={() => showAIAssistant.setState((state) => !state)}
          />
        </ClientOnly>
      )}
    </div>
  )
}
