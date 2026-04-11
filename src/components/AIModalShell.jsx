import { X } from 'lucide-react'

function AIModalShell({
  isOpen,
  onClose,
  label,
  title,
  description,
  maxWidth = 'max-w-2xl',
  children,
  footer,
}) {
  return (
    <div
      aria-hidden={!isOpen}
      onClick={onClose}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ease-out ${
        isOpen
          ? 'pointer-events-auto bg-slate-900/35 opacity-100'
          : 'pointer-events-none bg-slate-900/0 opacity-0'
      }`}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={`w-full ${maxWidth} rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-all duration-300 ease-out lg:p-6 ${
          isOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1.5 scale-[0.985] opacity-95'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {label && (
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-indigo-600">
                {label}
              </p>
            )}
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h3>
            {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-all duration-150 hover:bg-slate-50 hover:text-slate-700 active:scale-95"
          >
            <X size={16} />
          </button>
        </div>

        <div>{children}</div>

        {footer && <div className="mt-4 flex justify-end gap-2.5">{footer}</div>}
      </div>
    </div>
  )
}

export default AIModalShell
