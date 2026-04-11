import { createElement } from 'react'

function ActivityList({ title, items }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06),0_12px_24px_rgba(15,23,42,0.05)] lg:p-6">
      <h2 className="mb-5 text-[17px] font-semibold tracking-tight text-slate-900">
        {title}
      </h2>

      <div className="divide-y divide-slate-100">
        {items.map(({ text, timestamp, icon, iconToneClassName }) => (
          <div
            key={`${text}-${timestamp}`}
            className="flex items-start gap-3 rounded-xl py-3 transition-colors duration-150 hover:bg-slate-50/70"
          >
            <span
              className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-slate-200 ${iconToneClassName}`}
            >
              {createElement(icon, {
                size: 14,
                'aria-hidden': 'true',
                className: 'text-slate-600',
              })}
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{text}</p>
            </div>

            <span className="shrink-0 text-xs font-medium text-slate-400">
              {timestamp}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default ActivityList
