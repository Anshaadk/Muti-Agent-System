import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'

const API = ''

// ── utils ──────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2)
const ts  = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const extractScore = (t) => t?.match(/score[:\s]+(\d+(?:\.\d+)?)\/10/i)?.[1] ?? null
const formatDuration = (ms) => {
  if (!Number.isFinite(ms)) return '0s'
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}
const responseJson = async (response) => {
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || `Request failed (HTTP ${response.status})`)
  }
  return data || {}
}

// LocalStorage helpers
const LS_KEY = 'mas_sessions'
function loadSessions()      { try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] } }
function saveSessions(list)  { localStorage.setItem(LS_KEY, JSON.stringify(list)) }

function newSession(firstMsg = '') {
  return {
    id:        uid(),
    title:     firstMsg ? firstMsg.slice(0, 42) + (firstMsg.length > 42 ? '…' : '') : 'New Chat',
    createdAt: Date.now(),
    messages:  [],
  }
}

// ── CopyButton ─────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  const copyText = typeof text === 'string' ? text : ''
  const go = async () => {
    if (!copyText) return
    await navigator.clipboard.writeText(copyText)
    setDone(true)
    setTimeout(() => setDone(false), 1800)
  }
  return <button className={`copy-btn ${done ? 'copied' : ''}`} onClick={go}>{done ? '✓ Copied' : '⎘ Copy'}</button>
}

function RenderedResponse({ text = '' }) {
  const source = typeof text === 'string' ? text.trim() : String(text || '')
  const blocks = source.split(/(```[\w-]*\n[\s\S]*?```)/g).filter(Boolean)

  const renderInline = (line) => {
    const parts = line.split(/(`[^`]+`)/g)
    return parts.map((part, index) => part.startsWith('`') && part.endsWith('`')
      ? <code className="terminal-inline" key={index}>{part.slice(1, -1)}</code>
      : part)
  }

  return (
    <article className="assistant-response">
      <div className="assistant-response__toolbar">
        <span className="assistant-response__status"><i /> Response</span>
        <CopyButton text={source} />
      </div>
      <div className="assistant-response__content">
        {blocks.map((block, index) => {
          const fence = block.match(/^```([\w-]*)\n([\s\S]*?)```$/)
          if (fence) {
            return (
              <pre className="response-code" key={index}>
                {fence[1] && <span className="response-code__lang">{fence[1]}</span>}
                <code>{fence[2].trimEnd()}</code>
              </pre>
            )
          }

          return block.split(/\n\n+/).filter(Boolean).map((paragraph, paragraphIndex) => {
            const lines = paragraph.split('\n')
            const listLines = lines.filter(line => /^\s*(?:[-*] |\d+\.\s)/.test(line))
            if (listLines.length && listLines.length === lines.length) {
              const ordered = /^\s*\d+\.\s/.test(lines[0])
              const ListTag = ordered ? 'ol' : 'ul'
              return (
                <ListTag className="response-list" key={`${index}-${paragraphIndex}`}>
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex}>{renderInline(line.replace(/^\s*(?:[-*] |\d+\.\s)/, ''))}</li>
                  ))}
                </ListTag>
              )
            }

            return (
              <div className="response-lines" key={`${index}-${paragraphIndex}`}>
                {lines.map((line, lineIndex) => {
                  const heading = line.match(/^#{1,4}\s+(.+)/)
                  if (heading) return <div className="response-heading" key={lineIndex}>{heading[1]}</div>
                  if (!line.trim()) return <br key={lineIndex} />
                  return <div className="response-line" key={lineIndex}>{renderInline(line)}</div>
                })}
              </div>
            )
          })
        })}
      </div>
    </article>
  )
}

// ── Pipeline steps ─────────────────────────────────────────────────────────
const STEP_META = [
  { id: 1, icon: '🔍', title: 'Search Agent',  col: 'blue'   },
  { id: 2, icon: '📄', title: 'Reader Agent',  col: 'yellow' },
  { id: 3, icon: '✍️',  title: 'Writer',        col: 'purple' },
  { id: 4, icon: '🎯', title: 'Critic',         col: 'green'  },
]

function PipelineSteps({ steps }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="pipeline">
      {STEP_META.map(m => {
        const s = steps[m.id] || {}
        const st = s.status || 'idle'
        const isOpen = open === m.id
        return (
          <div key={m.id} className={`step step--${st}`}>
            <div className="step__head" onClick={() => s.content && setOpen(isOpen ? null : m.id)}
              style={{ cursor: s.content ? 'pointer' : 'default' }}>
              <span className={`step__dot step__dot--${st}`} />
              <span className={`step__icon step__icon--${m.col}`}>
                {st === 'running' ? <i className="spin-sm" /> : m.icon}
              </span>
              <span className="step__label">{m.title}</span>
              <span className="step__msg">{s.message || (st === 'idle' ? 'Waiting…' : '')}</span>
              <span className={`step__badge step__badge--${st}`}>
                {st === 'running' ? 'Running' : st === 'done' ? '✓ Done' : st === 'error' ? '✗ Error' : 'Idle'}
              </span>
              {s.duration_ms != null && <span className="step__time">{formatDuration(s.duration_ms)}</span>}
              {s.content && <span className={`chevron ${isOpen ? 'chevron--open' : ''}`}>›</span>}
            </div>
            {isOpen && s.content && (
              <div className="step__body"><pre>{s.content}</pre></div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ResearchLoading({ steps }) {
  const current = STEP_META.find(meta => steps[meta.id]?.status === 'running') ||
    STEP_META.find(meta => !steps[meta.id]?.status) || STEP_META[3]
  const completed = STEP_META.filter(meta => steps[meta.id]?.status === 'done').length
  const progress = Math.round((completed / STEP_META.length) * 100)

  return (
    <div className="research-loader" aria-live="polite">
      <div className="research-loader__orb">
        <span className="research-loader__orbit" />
        <span className="research-loader__icon">{current.icon}</span>
      </div>
      <div className="research-loader__copy">
        <div className="research-loader__eyebrow">Agent pipeline running</div>
        <div className="research-loader__title">{current.title}</div>
        <div className="research-loader__message">{steps[current.id]?.message || 'Preparing this agent...'}</div>
      </div>
      <div className="research-loader__count">{completed}/{STEP_META.length}</div>
      <div className="research-loader__track">
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}

// ── Research result panels ─────────────────────────────────────────────────
function ResearchResult({ result }) {
  const [open, setOpen] = useState({ report: true, feedback: true, search: false, scraped: false })
  const tog = k => setOpen(p => ({ ...p, [k]: !p[k] }))
  const score = extractScore(result.feedback)

  const Panel = ({ id, emoji, accent, title, children }) => (
    <div className={`panel panel--${accent}`}>
      <button className="panel__head" onClick={() => tog(id)}>
        <span>{emoji}</span>
        <span className="panel__title">{title}</span>
        <span className="panel__arr">{open[id] ? '▲' : '▼'}</span>
      </button>
      {open[id] && <div className="panel__body">{children}</div>}
    </div>
  )

  return (
    <div className="result-stack">
      <Panel id="report"  emoji="📋" accent="blue"   title="Research Report">
        <div className="panel__bar"><CopyButton text={result.report} /></div>
        <p className="prose">{result.report}</p>
      </Panel>
      <Panel id="feedback" emoji="🎯" accent="purple" title="Critic Review">
        {score && <div className="score-badge"><span className="score-num">{score}</span><span className="score-den">/10</span></div>}
        <div className="panel__bar"><CopyButton text={result.feedback} /></div>
        <p className="prose prose--muted">{result.feedback}</p>
      </Panel>
      <Panel id="search"  emoji="🔍" accent="yellow" title="Raw Search Results">
        <p className="prose prose--sm">{result.search_result}</p>
      </Panel>
      <Panel id="scraped" emoji="📄" accent="green"  title="Scraped Content">
        <p className="prose prose--sm">{result.scraped_content}</p>
      </Panel>
    </div>
  )
}

function ResearchTimer({ running, durationMs, startedAt }) {
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [running])

  const elapsed = durationMs != null
    ? durationMs
    : Math.max(0, now - (startedAt || 0))
  return (
    <span className={`research-time ${running ? 'research-time--live' : ''}`}>
      <span className="research-time__dot" />
      {running ? 'Elapsed' : 'Completed in'} {formatDuration(elapsed)}
    </span>
  )
}

function WelcomeScreen({ onPrompt }) {
  const suggestions = [
    ['Research a topic', 'Run a complete four-agent investigation'],
    ['Compare latest trends', 'Collect, read, write and critically review'],
    ['Prepare a brief', 'Turn reliable sources into a clear report'],
  ]

  return (
    <section className="welcome">
      <div className="welcome__logo">✦</div>
      <h1>How can I help you research?</h1>
      <p>Search, read, synthesize, and review complex topics with a connected research pipeline.</p>
      <div className="welcome__chips">
        {suggestions.map(([title, description]) => (
          <button key={title} className="welcome__chip" onClick={() => onPrompt(description)}>
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ── Confirm card ───────────────────────────────────────────────────────────
function ConfirmCard({ text, onYes, onNo }) {
  return (
    <div className="confirm-card">
      <p className="confirm-card__ico">🤔</p>
      <p className="confirm-card__text">{text}</p>
      <div className="confirm-card__btns">
        <button className="btn btn--green" onClick={onYes}><span>🔬</span> Yes — Deep Research</button>
        <button className="btn btn--red"   onClick={onNo} ><span>💬</span> No — Quick Answer</button>
      </div>
    </div>
  )
}

// ── Single message bubble ──────────────────────────────────────────────────
function Bubble({ msg, onYes, onNo }) {
  const isUser = msg.role === 'user'

  if (msg.type === 'confirm') return (
    <div className="row row--bot">
      <div className="ava">🤖</div>
      <div className="bubble-wrap">
        <ConfirmCard text={msg.text} onYes={onYes} onNo={onNo} />
        <span className="msg-time">{msg.time}</span>
      </div>
    </div>
  )

  if (msg.type === 'research') return (
    <div className="row row--bot">
      <div className="ava">🤖</div>
      <div className="bubble-wrap">
        <div className="bubble bubble--research">
          <div className="research-lbl">
            <span>🔬</span>
            <span>Deep Research: <strong>{msg.topic}</strong></span>
            {msg.running && <i className="spin-sm" />}
          </div>
          <div className="research-meta">
            <ResearchTimer
              running={msg.running}
              durationMs={msg.result?.duration_ms}
              startedAt={msg.startedAt || Date.now()}
            />
          </div>
          {msg.running && <ResearchLoading steps={msg.steps || {}} />}
          {msg.error && (
            <div className="research-error">
              <span className="research-error__icon">!</span>
              <div>
                <strong>Research pipeline stopped</strong>
                <p>{msg.error}</p>
              </div>
            </div>
          )}
          <PipelineSteps steps={msg.steps || {}} />
          {msg.result && <ResearchResult result={msg.result} />}
        </div>
        <span className="msg-time">{msg.time}</span>
      </div>
    </div>
  )

  return (
    <div className={`row ${isUser ? 'row--user' : 'row--bot'}`}>
      {!isUser && <div className="ava">🤖</div>}
      <div className="bubble-wrap">
        <div className={`bubble ${isUser ? 'bubble--user' : 'bubble--bot'}`}>
          {msg.loading
            ? <span className="dots"><span /><span /><span /></span>
            : isUser
              ? <span className="msg-text">{msg.text}</span>
              : <RenderedResponse text={msg.text} />}
        </div>
        <span className={`msg-time ${isUser ? 'msg-time--right' : ''}`}>{msg.time}</span>
      </div>
      {isUser && <div className="ava ava--user">👤</div>}
    </div>
  )
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ sessions, activeId, onSelect, onNew, onDelete, open, onClose }) {
  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar--open' : ''}`}>
        <div className="sidebar__head">
          <span className="sidebar__title">💬 Chat History</span>
          <button className="sidebar__close" onClick={onClose}>✕</button>
        </div>

        <button className="new-chat-btn" onClick={onNew}>
          <span>＋</span> New Chat
        </button>

        <div className="session-list">
          {sessions.length === 0 && (
            <p className="no-sessions">No history yet</p>
          )}
          {[...sessions].reverse().map(s => (
            <div
              key={s.id}
              className={`session-item ${s.id === activeId ? 'session-item--active' : ''}`}
              onClick={() => { onSelect(s.id); onClose() }}
            >
              <div className="session-item__icon">💬</div>
              <div className="session-item__info">
                <span className="session-item__title">{s.title}</span>
                <span className="session-item__date">
                  {new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <button
                className="session-item__del"
                onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                title="Delete"
              >🗑</button>
            </div>
          ))}
        </div>
      </aside>
    </>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
const WELCOME_MSG = {
  id: uid(), role: 'assistant', type: 'text', time: ts(),
  text: "Hi! Ask me anything.\n\nFor research-heavy topics I'll detect it and ask whether you want a full deep-research pipeline. Or click 🔬 to force deep research mode.",
}

export default function App() {
  // sessions state
  const [sessions, setSessions] = useState(() => {
    const stored = loadSessions()
    return stored.length ? stored : [newSession()]
  })
  const [activeId, setActiveId] = useState(() => sessions[sessions.length - 1]?.id || null)

  // current messages derived from active session
  const activeSession = sessions.find(s => s.id === activeId) || null
  const messages      = activeSession ? (activeSession.messages.length ? activeSession.messages : [WELCOME_MSG]) : [WELCOME_MSG]

  const [input,         setInput]         = useState('')
  const [busy,          setBusy]          = useState(false)
  const [forceResearch, setForceResearch] = useState(false)
  const [sidebarOpen,   setSidebarOpen]   = useState(false)
  const bottomRef = useRef(null)
  const abortRef  = useRef(null)

  // persist on change
  useEffect(() => { saveSessions(sessions) }, [sessions])

  // auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // ── session helpers ────────────────────────────────────────────────────
  const pushMsg = useCallback((msg) => {
    setSessions(prev => prev.map(s =>
      s.id !== activeId ? s : { ...s, messages: [...(s.messages.length ? s.messages : [WELCOME_MSG]), { id: uid(), ...msg }] }
    ))
  }, [activeId])

  const patchMsg = useCallback((msgId, update) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s
      return {
        ...s,
        messages: (s.messages.length ? s.messages : [WELCOME_MSG]).map(m =>
          m.id !== msgId ? m : { ...m, ...(typeof update === 'function' ? update(m) : update) }
        ),
      }
    }))
  }, [activeId])

  const setTitle = useCallback((title) => {
    setSessions(prev => prev.map(s => s.id !== activeId ? s : { ...s, title }))
  }, [activeId])

  // ── new / switch / delete session ─────────────────────────────────────
  const startNewSession = () => {
    const s = newSession()
    setSessions(prev => [...prev, s])
    setActiveId(s.id)
    setInput('')
    setBusy(false)
  }

  const selectSession = (id) => { setActiveId(id); setBusy(false) }

  const deleteSession = (id) => {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (id === activeId) {
      const remaining = sessions.filter(s => s.id !== id)
      const fallback = remaining.length ? remaining[remaining.length - 1] : newSession()
      if (!remaining.length) setSessions(prev => [...prev.filter(s => s.id !== id), fallback])
      setActiveId(fallback.id)
    }
  }

  const flushAll = () => {
    const s = newSession()
    setSessions([s])
    setActiveId(s.id)
    setBusy(false)
  }

  // ensure there's always an active session
  const ensureSession = () => {
    if (activeId && sessions.find(s => s.id === activeId)) return activeId
    const s = newSession()
    setSessions(prev => [...prev, s])
    setActiveId(s.id)
    return s.id
  }

  // ── send ───────────────────────────────────────────────────────────────
  const send = async (text = input.trim()) => {
    if (!text || busy) return
    ensureSession()
    setInput('')
    setBusy(true)

    // set session title from first user message
    if (!activeSession || activeSession.messages.length === 0) {
      setTitle(text.slice(0, 42) + (text.length > 42 ? '…' : ''))
    }

    pushMsg({ role: 'user', type: 'text', text, time: ts() })

    if (forceResearch) {
      setForceResearch(false)
      const resId = uid()
      setSessions(prev => prev.map(s => {
        if (s.id !== activeId) return s
        const base = s.messages.length ? s.messages : [WELCOME_MSG]
        return { ...s, messages: [...base, { id: resId, role: 'assistant', type: 'research', topic: text, running: true, steps: {}, result: null, startedAt: Date.now(), time: ts() }] }
      }))
      await doDeepResearch(text, resId)
      return
    }

    const thinkId = uid()
    setSessions(prev => prev.map(s => {
      if (s.id !== activeId) return s
      const base = s.messages.length ? s.messages : [WELCOME_MSG]
      return { ...s, messages: [...base, { id: thinkId, role: 'assistant', type: 'text', loading: true, text: '', time: ts() }] }
    }))

    try {
      const res  = await fetch(`${API}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: activeId }),
      })
      const data = await responseJson(res)
      if (data.type === 'confirm_research') {
        patchMsg(thinkId, { type: 'confirm', loading: false, text: data.message, topic: data.topic })
      } else {
        patchMsg(thinkId, { loading: false, type: 'text', text: data.message })
      }
    } catch (err) {
      patchMsg(thinkId, { loading: false, type: 'text', text: `⚠ ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  // ── simple reply ───────────────────────────────────────────────────────
  const doSimpleReply = async (topic, replaceId) => {
    setBusy(true)
    patchMsg(replaceId, { type: 'text', loading: true, text: '', time: ts() })
    try {
      const res  = await fetch(`${API}/api/simple`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: topic, session_id: activeId }),
      })
      const data = await responseJson(res)
      patchMsg(replaceId, { loading: false, type: 'text', text: data.message })
    } catch (err) {
      patchMsg(replaceId, { loading: false, type: 'text', text: `⚠ ${err.message}` })
    } finally {
      setBusy(false)
    }
  }

  // ── deep research ──────────────────────────────────────────────────────
  const doDeepResearch = async (topic, replaceId) => {
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    patchMsg(replaceId, { type: 'research', topic, running: true, steps: {}, result: null, startedAt: Date.now(), loading: false })

    try {
      const res = await fetch(`${API}/api/research/stream`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, session_id: activeId }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop()

        for (const part of parts) {
          const lines = part.trim().split('\n')
          let ev = 'message', payload = ''
          for (const l of lines) {
            if (l.startsWith('event: ')) ev      = l.slice(7).trim()
            if (l.startsWith('data: '))  payload = l.slice(6).trim()
          }
          if (!payload) continue
          let p; try { p = JSON.parse(payload) } catch { continue }

          if (ev === 'step') {
            patchMsg(replaceId, m => ({ steps: { ...m.steps, [p.step]: { status: p.status, message: p.message, content: p.content || '' } } }))
          } else if (ev === 'result') {
            patchMsg(replaceId, { result: p, running: false })
          } else if (ev === 'error') {
            patchMsg(replaceId, m => {
              const runningStep = Object.entries(m.steps || {}).find(([, step]) => step.status === 'running')
              const failedStep = runningStep
                ? { ...m.steps, [runningStep[0]]: { ...runningStep[1], status: 'error' } }
                : m.steps
              return {
                steps: failedStep,
                running: false,
                error: p.message || 'The research pipeline failed unexpectedly.',
              }
            })
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        patchMsg(replaceId, { running: false })
        pushMsg({ role: 'assistant', type: 'text', text: `⚠ ${err.message}`, time: ts() })
      }
    } finally {
      setBusy(false)
    }
  }

  // ── clear chromadb memory for current session ──────────────────────────
  const clearMemory = async () => {
    if (!activeId) return
    await fetch(`${API}/api/memory`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: activeId }),
    })
    setSessions(prev => prev.map(s =>
      s.id !== activeId ? s : { ...s, messages: [] }
    ))
  }

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  return (
    <div className="layout">
      {/* ── Sidebar ── */}
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={selectSession}
        onNew={startNewSession}
        onDelete={deleteSession}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* ── Main panel ── */}
      <div className="main">

        {/* Header */}
        <header className="hdr">
          <button className="hdr__menu" onClick={() => setSidebarOpen(true)} title="Chat history">
            <span /><span /><span />
          </button>
          <div className="hdr__brand">
            <span className="hdr__logo">🤖</span>
            <div>
              <div className="hdr__name">Multi-Agent Research</div>
              <div className="hdr__sub">Smart AI Pipeline</div>
            </div>
          </div>
          <div className="hdr__actions">
            <button className="hdr__btn" onClick={clearMemory} title="Clear memory for this chat">🗑 Clear Memory</button>
            <button className="hdr__btn hdr__btn--danger" onClick={flushAll} title="Delete all history">⚡ Flush All</button>
            <span className="online-dot">● Online</span>
          </div>
        </header>

        {/* Messages */}
        <div className="chat">
          <div className="chat__inner">
            {messages.length === 1 && messages[0] === WELCOME_MSG && (
              <WelcomeScreen onPrompt={send} />
            )}
            {messages.map(msg => (
              messages.length === 1 && msg === WELCOME_MSG ? null : (
                <Bubble
                  key={msg.id}
                  msg={msg}
                  onYes={msg.type === 'confirm' ? () => doDeepResearch(msg.topic, msg.id) : undefined}
                  onNo ={msg.type === 'confirm' ? () => doSimpleReply(msg.topic, msg.id)  : undefined}
                />
              )
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input bar */}
        <div className="bar">
          <button
            className={`research-toggle ${forceResearch ? 'research-toggle--on' : ''}`}
            onClick={() => setForceResearch(v => !v)}
            title={forceResearch ? 'Deep Research ON — click to disable' : 'Force Deep Research'}
          >
            🔬 <span>{forceResearch ? 'Deep ON' : 'Deep Research'}</span>
          </button>

          <textarea
            className="bar__input"
            rows={1}
            placeholder={forceResearch ? 'Enter research topic…' : 'Ask anything… (Enter to send)'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={busy}
            autoFocus
          />

          <button className="bar__send" onClick={() => send()} disabled={busy || !input.trim()}>
            {busy ? <i className="spin" /> : <span>↑</span>}
          </button>
        </div>
      </div>
    </div>
  )
}
