import {
  ChevronDown,
  ChevronUp,
  Clock3,
  GripVertical,
  Link2,
  Mail,
  Sparkles,
  Trash2,
} from 'lucide-react'

const STEP_TYPE_META = {
  email: {
    label: 'Email',
    icon: Mail,
    accent: 'border-sky-200 bg-sky-50 text-sky-700',
    dot: 'bg-sky-500',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Link2,
    accent: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    dot: 'bg-indigo-500',
  },
  wait: {
    label: 'Wait',
    icon: Clock3,
    accent: 'border-amber-200 bg-amber-50 text-amber-700',
    dot: 'bg-amber-500',
  },
  ai_action: {
    label: 'AI Action',
    icon: Sparkles,
    accent: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
    dot: 'bg-fuchsia-500',
  },
}

function normalizeStepType(stepType) {
  const normalized = String(stepType || '').toLowerCase()
  if (normalized === 'email') return 'email'
  if (normalized === 'linkedin') return 'linkedin'
  if (normalized === 'wait') return 'wait'
  if (normalized === 'ai_action') return 'ai_action'
  return 'email'
}

function getSummary(step) {
  const type = normalizeStepType(step?.stepType)
  const delay = Number(step?.delayDays || 0)
  const delayLabel = delay === 0 ? 'Immediate' : `${delay}d delay`
  const bodyReady = step?.body?.trim() ? 'Content ready' : 'Draft empty'
  return `${STEP_TYPE_META[type].label} • ${delayLabel} • ${bodyReady}`
}

function WorkflowStepCard({
  step,
  index,
  isExpanded,
  isDragging,
  onToggle,
  onChange,
  onRemove,
  stepTypeOptions,
  dragHandleProps,
}) {
  const type = normalizeStepType(step?.stepType)
  const meta = STEP_TYPE_META[type]
  const Icon = meta.icon

  return (
    <div className="relative">
      <div
        className={`absolute -left-[1.6rem] top-6 hidden h-3 w-3 rounded-full border-2 border-white shadow sm:block ${meta.dot}`}
      />

      <div
        className={`rounded-2xl border bg-white shadow-sm transition-all duration-200 ${
          isDragging
            ? 'scale-[1.01] border-indigo-300 shadow-lg ring-2 ring-indigo-100'
            : isExpanded
              ? 'border-indigo-200 shadow-md'
              : 'border-slate-200 hover:-translate-y-0.5 hover:shadow-md'
        }`}
      >
        <div className="flex items-start gap-2 px-3 pt-3">
          <button
            type="button"
            aria-label="Drag step"
            className="mt-0.5 inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 active:cursor-grabbing"
            {...dragHandleProps}
          >
            <GripVertical size={13} />
          </button>

          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-start justify-between gap-3 pb-3 text-left"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.accent}`}
                >
                  <Icon size={12} />
                  {meta.label}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Step {index + 1}
                </span>
              </div>
              <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                {step?.subject?.trim() || `${meta.label} Step`}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{getSummary(step)}</p>
            </div>

            <span className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50 p-1 text-slate-600">
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
        </div>

        {isExpanded && (
          <div className="border-t border-slate-100 px-4 py-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Type
                </label>
                <select
                  value={step?.stepType || 'email'}
                  onChange={(event) => onChange({ stepType: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                >
                  {stepTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Delay (days)
                </label>
                <input
                  type="number"
                  min={0}
                  value={step?.delayDays ?? 0}
                  onChange={(event) => onChange({ delayDays: Number(event.target.value || 0) })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Title / Subject
                </label>
                <input
                  value={step?.subject || ''}
                  onChange={(event) => onChange({ subject: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                  placeholder="Step title or email subject"
                />
              </div>
            </div>

            <div className="mt-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Body
              </label>
              <textarea
                rows={4}
                value={step?.body || ''}
                onChange={(event) => onChange({ body: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                placeholder="Write step content, prompt, or automation instructions..."
              />
            </div>

            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onRemove}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
              >
                <Trash2 size={12} /> Remove Step
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WorkflowStepCard
