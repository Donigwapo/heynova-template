import { createElement } from 'react'

function StatCard({ label, value, icon, dotClassName = 'bg-slate-300' }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_20px_rgba(15,23,42,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_6px_rgba(15,23,42,0.06),0_14px_28px_rgba(15,23,42,0.08)] lg:p-6">
      <div className="mb-5 flex items-start justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
          {label}
        </p>

        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
          <span className={`h-2 w-2 rounded-full ${dotClassName}`} />
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-white text-slate-600 ring-1 ring-slate-200">
            {createElement(icon, { size: 14, 'aria-hidden': 'true' })}
          </span>
        </div>
      </div>

      <p className="text-3xl font-semibold tracking-tight text-slate-900 lg:text-[2rem]">
        {value}
      </p>
    </article>
  )
}

export default StatCard
