import { createElement, useMemo, useState } from 'react'
import { Bell, CircleHelp, Search, Settings } from 'lucide-react'

const commandSuggestions = [
  'Draft follow-up for John',
  'Summarize last meeting',
  'Show overdue follow-ups',
  'Show my open tasks',
  'Find contact John Smith',
  'Create workflow for lead follow-up',
]

function parseCommand(rawInput) {
  const input = rawInput.trim().toLowerCase()

  if (!input) return null

  if (input.includes('draft') && input.includes('follow-up')) {
    return { type: 'followUp' }
  }

  if (input.includes('summarize') && input.includes('meeting')) {
    return { type: 'meetingSummary' }
  }

  if (input.includes('overdue') && input.includes('follow')) {
    return { type: 'overdueFollowUps' }
  }

  if (input.includes('open tasks') || input.includes('show my tasks')) {
    return { type: 'aiTasks' }
  }

  if (input.includes('find contact') || input.includes('find a contact')) {
    const match = input.match(/find(?: a)? contact\s+(.*)$/)
    return {
      type: 'findContact',
      query: match?.[1] ? match[1].trim() : '',
    }
  }

  if (input.includes('create workflow')) {
    return { type: 'workflowDraft' }
  }

  return null
}

function TopHeader({ onRunCommand, userProfile }) {
  const [commandInput, setCommandInput] = useState('')
  const [isCommandFocused, setIsCommandFocused] = useState(false)
  const [commandFeedback, setCommandFeedback] = useState('')
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1)

  const actionButtons = [
    { label: 'Notifications', icon: Bell },
    { label: 'Settings', icon: Settings },
    { label: 'Help', icon: CircleHelp },
  ]

  const filteredSuggestions = useMemo(() => {
    const query = commandInput.trim().toLowerCase()

    if (!query) return commandSuggestions

    return commandSuggestions.filter((suggestion) =>
      suggestion.toLowerCase().includes(query)
    )
  }, [commandInput])

  const runCommand = (commandText) => {
    const parsedCommand = parseCommand(commandText)

    if (!parsedCommand) {
      setCommandFeedback('No matching command found')
      return
    }

    onRunCommand?.(parsedCommand)
    setCommandInput('')
    setSelectedSuggestionIndex(-1)
    setCommandFeedback('')
    setIsCommandFocused(false)
  }

  const handleCommandKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!filteredSuggestions.length) return

      setSelectedSuggestionIndex((prev) => {
        const next = prev + 1
        return next >= filteredSuggestions.length ? 0 : next
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!filteredSuggestions.length) return

      setSelectedSuggestionIndex((prev) => {
        if (prev <= 0) return filteredSuggestions.length - 1
        return prev - 1
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()

      if (
        selectedSuggestionIndex >= 0 &&
        selectedSuggestionIndex < filteredSuggestions.length
      ) {
        runCommand(filteredSuggestions[selectedSuggestionIndex])
        return
      }

      runCommand(commandInput)
    }
  }

  const showSuggestions = isCommandFocused && !commandFeedback

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-6">
      <div className="relative w-full max-w-md">
        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={commandInput}
            onChange={(event) => {
              setCommandInput(event.target.value)
              setSelectedSuggestionIndex(-1)
              if (commandFeedback) setCommandFeedback('')
            }}
            onKeyDown={handleCommandKeyDown}
            onFocus={() => {
              setIsCommandFocused(true)
              setSelectedSuggestionIndex(-1)
            }}
            onBlur={() => setTimeout(() => setIsCommandFocused(false), 120)}
            placeholder="Search or type a command..."
            className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 transition-all duration-150 focus:border-slate-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-200/60"
          />
        </label>

        {(showSuggestions || commandFeedback) && (
          <div className="absolute left-0 right-0 top-full z-30 mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            {commandFeedback ? (
              <p className="px-2 py-1 text-xs font-medium text-amber-700">
                {commandFeedback}. Try “Summarize last meeting”.
              </p>
            ) : filteredSuggestions.length ? (
              <ul className="space-y-1">
                {filteredSuggestions.map((suggestion, index) => {
                  const isSelected = index === selectedSuggestionIndex

                  return (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => runCommand(suggestion)}
                        className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors duration-150 ${
                          isSelected
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                        }`}
                      >
                        {suggestion}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-2 py-1 text-xs text-slate-500">No matching command found. Try “Summarize last meeting”.</p>
            )}
          </div>
        )}
      </div>

      <div className="ml-4 flex items-center gap-2">
        {actionButtons.map(({ label, icon }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-transparent text-slate-500 transition-all duration-150 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 hover:shadow-sm"
          >
            {createElement(icon, { size: 17 })}
          </button>
        ))}

        <button
          type="button"
          aria-label="User profile"
          className="ml-1 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-all duration-150 hover:bg-slate-200 hover:shadow-sm"
          title={
            userProfile?.companyName
              ? `${userProfile?.displayName || 'User'} · ${userProfile.companyName}`
              : userProfile?.email || userProfile?.displayName || 'User profile'
          }
        >
          {userProfile?.avatarUrl ? (
            <img
              src={userProfile.avatarUrl}
              alt={`${userProfile.displayName || 'User'} avatar`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{userProfile?.initials || 'U'}</span>
          )}
          <span className="sr-only">{userProfile?.displayName || 'User'} profile</span>
        </button>
      </div>
    </header>
  )
}

export default TopHeader
