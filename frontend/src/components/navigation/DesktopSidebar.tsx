import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed, useSidebarSectionCollapsed } from '@/hooks/useSidebarCollapsed'
import { emitSidebarAction } from '@/hooks/useSidebarAction'
import { useAuth } from '@/hooks/useAuth'
import { useUrlParams } from '@/hooks/useUrlParams'
import { buildNavModel, type MoreDrawerItem, type NavPrimaryCta } from '@/components/navigation/moreDrawerItems'
import { getPathWithReturnTo } from '@/lib/navigation'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import { DesktopSessionTree } from '@/components/navigation/DesktopSessionTree'
import {
  Sidebar,
  SidebarCollapsibleSection,
  SidebarSection,
  SidebarItem,
} from '@/components/ui/sidebar'
import { FolderGit2 } from 'lucide-react'

const ACCOUNT_ITEM_KEYS = new Set(['settings', 'logout'])

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const [collapsed, toggle] = useSidebarCollapsed()
  const [sessionsCollapsed, toggleSessionsCollapsed] = useSidebarSectionCollapsed('sessions')
  const [menuCollapsed, toggleMenuCollapsed] = useSidebarSectionCollapsed('menu')
  const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false)
  const { isAuthenticated, isLoading, logout } = useAuth()

  const isDesktop = useDesktop()

  if (isLoading || !isAuthenticated) {
    return null
  }

  if (!isDesktop) {
    return null
  }

  const { primary, items } = buildNavModel(location.pathname)

  const handlePrimaryClick = (item: NavPrimaryCta) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.onSelect) {
      emitSidebarAction(item.onSelect)
    }
  }

  const handleItemClick = (item: MoreDrawerItem) => {
    if (item.to) {
      const to = item.key === 'schedules'
        ? getPathWithReturnTo(item.to, `${location.pathname}${location.search}`)
        : item.to
      navigate(to)
    } else if (item.dialog) {
      updateParams((p) => {
        p.set('dialog', item.dialog!)
        p.delete('mobileTab')
      }, 'push')
    } else if (item.key === 'logout') {
      logout()
    } else if (item.key === 'settings') {
      updateParams((p) => {
        p.set('settings', 'open')
        p.set('settingsTab', 'account')
        p.delete('mobileTab')
      }, 'push')
    } else if (item.key === 'repos') {
      setRepoSwitcherOpen(true)
    }
  }

  const [homeItem, ...routeItems] = items
  const navItems: MoreDrawerItem[] = [
    homeItem,
    { key: 'repos', label: 'Repos', icon: FolderGit2 },
    ...routeItems,
  ]
  const toolItems = navItems.filter((item) => !ACCOUNT_ITEM_KEYS.has(item.key))
  const accountItems = navItems.filter((item) => ACCOUNT_ITEM_KEYS.has(item.key))

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggle} widthClass='w-72' className='mt-2'>
        {primary.length > 0 && (
          <SidebarSection collapsed={collapsed}>
            {primary.map((item: NavPrimaryCta) => (
              <SidebarItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                collapsed={collapsed}
                onClick={() => handlePrimaryClick(item)}
                asPrimary
                variant={item.variant}
              />
            ))}
          </SidebarSection>
        )}

        {collapsed ? (
          <div className="flex flex-col gap-1 p-2 pt-0">
            {navItems.map((item: MoreDrawerItem) => (
              <SidebarItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                collapsed={collapsed}
                onClick={() => handleItemClick(item)}
                danger={item.danger}
              />
            ))}
          </div>
        ) : (
          <>
            <SidebarCollapsibleSection
              label="Sessions"
              collapsed={sessionsCollapsed}
              onToggle={toggleSessionsCollapsed}
              className="border-t border-border"
            >
              <DesktopSessionTree />
            </SidebarCollapsibleSection>

            <SidebarCollapsibleSection
              label="Menu"
              collapsed={menuCollapsed}
              onToggle={toggleMenuCollapsed}
              className="flex-1 min-h-fit border-t border-border"
              contentClassName="overflow-y-auto"
            >
              <div className="flex flex-col gap-1 p-2 pt-0">
                {toolItems.map((item: MoreDrawerItem) => (
                  <SidebarItem
                    key={item.key}
                    icon={item.icon}
                    label={item.label}
                    collapsed={false}
                    onClick={() => handleItemClick(item)}
                    danger={item.danger}
                  />
                ))}
              </div>
            </SidebarCollapsibleSection>

            <div className="flex gap-1 border-t border-border p-2">
              {accountItems.map((item: MoreDrawerItem) => (
                <SidebarItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  collapsed
                  onClick={() => handleItemClick(item)}
                  danger={item.danger}
                />
              ))}
            </div>
          </>
        )}
      </Sidebar>

      <RepoQuickSwitchSheet
        isOpen={repoSwitcherOpen}
        onClose={() => setRepoSwitcherOpen(false)}
      />
    </>
  )
}
