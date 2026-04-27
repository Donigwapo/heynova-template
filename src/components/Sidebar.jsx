import { createElement, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3,
  Bot,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Home,
  Inbox,
  Megaphone,
  Plug,
  Settings,
  Users,
  Workflow,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', icon: Home },
  { label: 'Assistant', icon: Bot },
  { label: 'Contacts', icon: Users },
  { label: 'Meetings', icon: Calendar },
  { label: 'Workflows', icon: Workflow },
  { label: 'Tasks', icon: CheckSquare },
  { label: 'Inbox', icon: Inbox },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Integrations', icon: Plug },
  { label: 'Settings', icon: Settings },
]

const campaignItems = [
  {
    label: 'Lead Extractor',
    route: '/campaigns/lead-extractor',
  },
  {
    label: 'Lead Database',
    route: '/campaigns/lead-database',
  },
]

function Sidebar({ activeItem = 'Dashboard', userProfile }) {
  const navigate = useNavigate()

  const navRouteMap = {
    Dashboard: '/dashboard',
    Inbox: '/inbox',
    Integrations: '/integrations',
  }

  const hasCampaignActiveChild = useMemo(
    () => campaignItems.some((item) => item.label === activeItem),
    [activeItem]
  )

  const [isCampaignsOpen, setIsCampaignsOpen] = useState(hasCampaignActiveChild)

  return (
    <div className="flex h-full min-h-[26rem] flex-col bg-white p-4 lg:p-5">
      <div className="mb-6 flex items-center gap-2 px-2">
        <img
          src="/brand/heynova-logo.png"
          alt="Heynova logo"
          className="h-6 w-6 rounded-md object-cover ring-1 ring-slate-200"
        />
        <span className="text-lg font-semibold tracking-tight text-slate-900">Heynova</span>
      </div>

      <nav className="flex-1 space-y-1.5" aria-label="Sidebar navigation">
        {navItems.map(({ label, icon }) => {
          const isActive = label === activeItem

          return (
            <div key={label}>
              <button
                type="button"
                onClick={() => {
                  const route = navRouteMap[label]
                  if (route) navigate(route)
                }}
                className={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'border-slate-200 bg-slate-100/90 text-slate-900 shadow-sm'
                    : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100/80 hover:text-slate-900 hover:shadow-sm'
                }`}
              >
                {createElement(icon, {
                  size: 17,
                  className: `shrink-0 transition-colors duration-150 ${
                    isActive ? 'text-slate-700' : 'text-slate-400 group-hover:text-slate-700'
                  }`,
                })}
                <span>{label}</span>
              </button>

              {label === 'Assistant' && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setIsCampaignsOpen((prev) => !prev)}
                    className={`group flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all duration-150 ${
                      hasCampaignActiveChild
                        ? 'border-slate-200 bg-slate-100/90 text-slate-900 shadow-sm'
                        : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-100/80 hover:text-slate-900 hover:shadow-sm'
                    }`}
                    aria-expanded={isCampaignsOpen}
                    aria-controls="campaigns-submenu"
                  >
                    <span className="inline-flex items-center gap-3">
                      <Megaphone
                        size={17}
                        className={
                          hasCampaignActiveChild
                            ? 'text-slate-700'
                            : 'text-slate-400 transition-colors duration-150 group-hover:text-slate-700'
                        }
                      />
                      <span>Campaigns</span>
                    </span>
                    {isCampaignsOpen ? (
                      <ChevronDown size={16} className="text-slate-500" />
                    ) : (
                      <ChevronRight size={16} className="text-slate-500" />
                    )}
                  </button>

                  {isCampaignsOpen && (
                    <div id="campaigns-submenu" className="ml-8 mt-1 space-y-1 border-l border-slate-200 pl-2">
                      {campaignItems.map((item) => {
                        const isSubActive = activeItem === item.label

                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => navigate(item.route)}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-medium transition-all duration-150 ${
                              isSubActive
                                ? 'bg-slate-100 text-slate-900'
                                : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800'
                            }`}
                          >
                            <span>{item.label}</span>
                            {isSubActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-2">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl border border-transparent px-2 py-1.5 text-left transition-all duration-150 hover:border-slate-200 hover:bg-white hover:shadow-sm"
        >
          <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            {userProfile?.avatarUrl ? (
              <img
                src={userProfile.avatarUrl}
                alt={`${userProfile.displayName || 'User'} avatar`}
                className="h-full w-full object-cover"
              />
            ) : (
              userProfile?.initials || 'U'
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{userProfile?.displayName || 'User'}</p>
            {userProfile?.isProfileLoading ? (
              <p className="truncate text-xs text-slate-400">Loading profile...</p>
            ) : (
              <p className="truncate text-xs text-slate-500">{userProfile?.email || 'No email'}</p>
            )}
            {userProfile?.role && <p className="truncate text-[11px] text-slate-400">{userProfile.role}</p>}
          </div>
          <ChevronDown size={16} className="text-slate-500" />
        </button>
      </div>
    </div>
  )
}

export default Sidebar
