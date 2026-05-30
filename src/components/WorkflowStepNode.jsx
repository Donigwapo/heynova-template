import {
  ChevronDown,
  ChevronUp,
  Clock3,
  GitBranch,
  GripVertical,
  Link2,
  Mail,
  OctagonX,
  Sparkles,
  Trash2,
} from 'lucide-react'

const NODE_META = {
  email: {
    label: 'Email',
    icon: Mail,
    accent: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Link2,
    accent: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  wait: {
    label: 'Wait',
    icon: Clock3,
    accent: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  ai_action: {
    label: 'AI Action',
    icon: Sparkles,
    accent: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
  },
  condition: {
    label: 'Condition / Branch',
    icon: GitBranch,
    accent: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  stop: {
    label: 'Stop',
    icon: OctagonX,
    accent: 'border-rose-200 bg-rose-50 text-rose-700',
  },
}

function normalizeType(type) {
  const key = String(type || 'email').toLowerCase()
  return NODE_META[key] ? key : 'email'
}

function WorkflowStepNode({
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
  const type = normalizeType(step?.stepType)
  const meta = NODE_META[type]
  const Icon = meta.icon

  const delay = Number(step?.delayDays || 0)
  const delayLabel = delay === 0 ? 'Immediate' : `${delay}d delay`

  const conditionLabel = step?.metadata?.conditionLabel || 'Did lead reply?'
  const yesLabel = step?.metadata?.yesLabel || 'Yes'
  const noLabel = step?.metadata?.noLabel || 'No'

  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm transition-all duration-200 ${
        isDragging
          ? 'border-indigo-300 ring-2 ring-indigo-100 shadow-lg'
          : isExpanded
            ? 'border-indigo-200 shadow-md'
            : 'border-slate-200 hover:-translate-y-0.5 hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-2 px-3 pt-3">
        <button
          type="button"
          aria-label="Drag node"
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
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.accent}`}>
                <Icon size={12} />
                {meta.label}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Node {index + 1}</span>
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {step?.subject?.trim() || `${meta.label} Step`}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">{meta.label} • {delayLabel}</p>

            {type === 'condition' && (
              <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50/70 p-2">
                <p className="text-xs font-medium text-violet-800">{conditionLabel}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700">{yesLabel}</span>
                  <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-rose-700">{noLabel}</span>
                </div>
              </div>
            )}
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
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Type</label>
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
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Delay (days)</label>
              <input
                type="number"
                min={0}
                value={step?.delayDays ?? 0}
                onChange={(event) => onChange({ delayDays: Number(event.target.value || 0) })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Title / Subject</label>
              <input
                value={step?.subject || ''}
                onChange={(event) => onChange({ subject: event.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
                placeholder="Node title"
              />
            </div>
          </div>

          {type === 'condition' && (
            <div className="mt-2 rounded-xl border border-violet-200 bg-violet-50/70 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Branch Setup (Phase 1)</p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <input
                  value={conditionLabel}
                  onChange={(event) =>
                    onChange({
                      metadata: {
                        ...(step?.metadata || {}),
                        conditionLabel: event.target.value,
                      },
                    })
                  }
                  className="rounded-lg border border-violet-200 bg-white px-2 py-2 text-sm text-slate-800"
                  placeholder="Condition question"
                />
                <input
                  value={yesLabel}
                  onChange={(event) =>
                    onChange({
                      metadata: {
                        ...(step?.metadata || {}),
                        yesLabel: event.target.value,
                      },
                    })
                  }
                  className="rounded-lg border border-emerald-200 bg-white px-2 py-2 text-sm text-slate-800"
                  placeholder="Yes label"
                />
                <input
                  value={noLabel}
                  onChange={(event) =>
                    onChange({
                      metadata: {
                        ...(step?.metadata || {}),
                        noLabel: event.target.value,
                      },
                    })
                  }
                  className="rounded-lg border border-rose-200 bg-white px-2 py-2 text-sm text-slate-800"
                  placeholder="No label"
                />
              </div>
            </div>
          )}

          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Body</label>
            <textarea
              rows={4}
              value={step?.body || ''}
              onChange={(event) => onChange({ body: event.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-800"
              placeholder="Write action details..."
            />
          </div>

          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              <Trash2 size={12} /> Remove Node
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default WorkflowStepNode
