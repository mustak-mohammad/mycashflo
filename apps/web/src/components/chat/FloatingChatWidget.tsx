import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/AuthContext'
import { chotuApi } from '../../api/chotu'
import type { ChotuChatMessage } from '../../../../../packages/shared-types'

// Safe lightweight markdown-like text formatter with NO dangerouslySetInnerHTML
function SafeFormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n')

  return (
    <div className="space-y-1.5 text-xs leading-relaxed break-words">
      {lines.map((line, idx) => {
        const trimmed = line.trim()
        if (!trimmed) {
          return <div key={idx} className="h-1" />
        }

        // Header 3: ### Title
        if (trimmed.startsWith('### ')) {
          return (
            <div key={idx} className="font-semibold text-sm text-indigo-300 mt-2 mb-1">
              {trimmed.replace('### ', '')}
            </div>
          )
        }

        // Bullet point: • or - or *
        if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const content = trimmed.slice(2)
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="text-indigo-400 shrink-0 select-none">•</span>
              <span>{renderInlineFormatting(content)}</span>
            </div>
          )
        }

        return <div key={idx}>{renderInlineFormatting(trimmed)}</div>
      })}
    </div>
  )
}

function renderInlineFormatting(text: string) {
  // Regex to split on bold **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      )
    }
    // Also handle italics *italic*
    const italicParts = part.split(/(\*[^*]+\*)/g)
    return italicParts.map((sub, j) => {
      if (sub.startsWith('*') && sub.endsWith('*') && !sub.startsWith('**')) {
        return (
          <em key={`${i}-${j}`} className="italic text-slate-300">
            {sub.slice(1, -1)}
          </em>
        )
      }
      return sub
    })
  })
}

export function FloatingChatWidget() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [isOpen, setIsOpen] = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const [messages, setMessages] = useState<ChotuChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string>(() => `conv_${Date.now()}`)
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const role = user?.role || 'AGENT'
  const isAgent = role === 'AGENT'

  // Contextual suggested prompts based on user role and current page
  const suggestedPrompts = isAgent
    ? [
        'Which of my assigned invoices are overdue?',
        'Which assigned customers need follow-up?',
        'Explain my collection performance.',
        'How do I submit a payment claim?',
      ]
    : [
        'Give me an overview of outstanding invoices.',
        'Which invoices are overdue?',
        'Summarize recent payment collections.',
        'How do I generate an ageing report?',
      ]

  // Auto-scroll to bottom of messages
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (isOpen && !isMinimized) {
      scrollToBottom()
    }
  }, [messages, isOpen, isMinimized, scrollToBottom])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen, isMinimized])

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        setIsMinimized(true)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend ?? input).trim()
    if (!messageText || loading) return

    setError(null)
    setLastFailedMessage(null)
    setInput('')

    const userMessage: ChotuChatMessage = {
      id: `msg_user_${Date.now()}`,
      sender: 'user',
      text: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setLoading(true)

    try {
      const response = await chotuApi.chat({
        message: messageText,
        conversationId,
        currentPage: location.pathname,
      })

      if (response.conversationId) {
        setConversationId(response.conversationId)
      }

      const assistantMessage: ChotuChatMessage = {
        id: `msg_ai_${Date.now()}`,
        sender: 'assistant',
        text: response.reply,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        suggestedQuestions: response.suggestedQuestions,
        suggestedRoute: response.suggestedRoute,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err: any) {
      const errorMsg =
        err?.response?.data?.message ||
        err?.message ||
        'Unable to connect to Chotu Intelligence. Please try again.'
      setError(errorMsg)
      setLastFailedMessage(messageText)
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = () => {
    if (lastFailedMessage) {
      handleSendMessage(lastFailedMessage)
    }
  }

  const handleClearChat = () => {
    setMessages([])
    setError(null)
    setConversationId(`conv_${Date.now()}`)
  }

  // Toggle launcher button
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => {
            setIsOpen(true)
            setIsMinimized(false)
          }}
          className="group relative flex items-center gap-2.5 px-4 py-3 rounded-full text-white font-medium shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            boxShadow: '0 8px 24px -4px rgba(99, 102, 241, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15)',
          }}
          aria-label="Open Chotu AI Chatbot"
        >
          <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-sm">
            🤖
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          </div>
          <span className="text-sm font-semibold tracking-wide">Ask Chotu</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-black/25 text-indigo-100 font-mono">AI</span>
        </button>
      </div>
    )
  }

  // Minimized state
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl cursor-pointer transition-all duration-200 hover:scale-105 border border-indigo-500/40"
          style={{ background: 'var(--surface)', color: 'var(--text)' }}
          role="button"
          tabIndex={0}
          aria-label="Restore Chotu AI Chatbot"
        >
          <span className="text-base">🤖</span>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white">Chotu AI</span>
            <span className="text-[10px] text-emerald-400">● Active</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen(false)
            }}
            className="ml-2 text-slate-400 hover:text-white text-xs p-1"
            title="Close chatbot"
            aria-label="Close chatbot"
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  // Fully open chat panel
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 border border-slate-700/80"
      style={{
        width: '400px',
        maxWidth: 'calc(100vw - 32px)',
        height: '560px',
        maxHeight: 'calc(100vh - 100px)',
        background: '#0f172a',
        boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(99, 102, 241, 0.25)',
      }}
      role="dialog"
      aria-labelledby="chotu-chat-title"
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-4 py-3 shrink-0 border-b border-slate-800"
        style={{ background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)' }}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-indigo-600/30 border border-indigo-400/40 text-base">
            🤖
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 id="chotu-chat-title" className="text-sm font-semibold text-white">
                Chotu AI
              </h2>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                Read-Only
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Collections Assistant • {role}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-slate-400">
          <button
            onClick={handleClearChat}
            className="p-1.5 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors text-xs"
            title="Clear chat history"
            aria-label="Clear chat history"
          >
            🧹
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors text-xs"
            title="Minimize window"
            aria-label="Minimize window"
          >
            ⎯
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors text-xs"
            title="Close chat"
            aria-label="Close chat"
          >
            ✕
          </button>
        </div>
      </header>

      {/* Message Feed / Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scroll-smooth">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-6 px-2">
            <div className="w-12 h-12 rounded-2xl bg-indigo-950/60 border border-indigo-500/30 flex items-center justify-center text-2xl mb-3 shadow-inner">
              🤖
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">Welcome to Chotu AI</h3>
            <p className="text-xs text-slate-400 max-w-[280px] mb-4">
              Ask questions about outstanding invoices, overdue balances, customer histories, and platform features.
            </p>

            <div className="w-full text-left space-y-1.5">
              <p className="text-[11px] font-medium text-slate-400 px-1">Suggested inquiries:</p>
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(prompt)}
                  className="w-full text-left px-3 py-2 rounded-xl text-xs bg-slate-900/90 hover:bg-indigo-950/50 text-slate-200 border border-slate-800 hover:border-indigo-500/40 transition-all cursor-pointer flex items-center justify-between group"
                >
                  <span className="truncate">{prompt}</span>
                  <span className="text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    →
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                  msg.sender === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-xs'
                    : 'bg-slate-800/90 text-slate-200 rounded-bl-xs border border-slate-700/60'
                }`}
              >
                {msg.sender === 'assistant' ? (
                  <SafeFormattedMessage text={msg.text} />
                ) : (
                  <div className="text-xs whitespace-pre-wrap">{msg.text}</div>
                )}
              </div>

              <div className="flex items-center gap-1.5 mt-1 px-1 text-[10px] text-slate-500">
                <span>{msg.sender === 'user' ? 'You' : 'Chotu'}</span>
                <span>•</span>
                <span>{msg.timestamp}</span>
              </div>

              {/* Contextual Route button if suggested */}
              {msg.suggestedRoute && (
                <div className="mt-1.5 pl-1">
                  <button
                    onClick={() => {
                      if (msg.suggestedRoute) navigate(msg.suggestedRoute)
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-indigo-950/40 hover:bg-indigo-950/80 px-2.5 py-1 rounded-lg border border-indigo-500/30 transition-all cursor-pointer"
                  >
                    <span>Open {msg.suggestedRoute.replace('/', '').toUpperCase()}</span>
                    <span>→</span>
                  </button>
                </div>
              )}

              {/* Follow-up question chips */}
              {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2 max-w-[95%]">
                  {msg.suggestedQuestions.map((q, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(q)}
                      disabled={loading}
                      className="text-[11px] text-slate-300 bg-slate-800/60 hover:bg-indigo-900/40 border border-slate-700/70 hover:border-indigo-400/50 px-2.5 py-1 rounded-full transition-all text-left truncate cursor-pointer disabled:opacity-50"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* Loading / Typing indicator */}
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-xs pl-2">
            <span className="animate-spin text-sm">🤖</span>
            <span>Chotu is thinking…</span>
          </div>
        )}

        {/* Error Alert with Retry */}
        {error && (
          <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-200 text-xs flex items-center justify-between gap-2">
            <span>⚠️ {error}</span>
            {lastFailedMessage && (
              <button
                onClick={handleRetry}
                className="shrink-0 px-2 py-1 rounded bg-red-900/60 hover:bg-red-800 text-white font-medium text-[11px] cursor-pointer"
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Form */}
      <footer className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              maxLength={1000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              placeholder="Ask Chotu anything about invoices, customers, collections…"
              disabled={loading}
              className="w-full resize-none rounded-xl bg-slate-950 border border-slate-800 focus:border-indigo-500 focus:outline-none px-3.5 py-2.5 text-xs text-white placeholder-slate-500 transition-colors disabled:opacity-50"
              style={{ maxHeight: '80px' }}
            />
          </div>

          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white disabled:text-slate-500 transition-all cursor-pointer disabled:cursor-not-allowed shrink-0 flex items-center justify-center shadow-md"
            title="Send Message (Enter)"
            aria-label="Send message"
          >
            <span className="text-sm">➤</span>
          </button>
        </form>

        <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-slate-500">
          <span>Read-only assistant • Financial mutations disabled</span>
          <span>{input.length}/1000</span>
        </div>
      </footer>
    </div>
  )
}
