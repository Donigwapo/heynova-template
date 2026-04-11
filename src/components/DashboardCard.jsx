function DashboardCard({ title, children }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_2px_8px_rgba(15,23,42,0.06),0_12px_24px_rgba(15,23,42,0.05)] lg:p-6">
      <h2 className="mb-5 text-[17px] font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <div className="space-y-1">{children}</div>
    </article>
  )
}

export default DashboardCard
