import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useAuth } from '@/hooks/useAuth'
import { useUrlParams } from '@/hooks/useUrlParams'
import { useOpenNavItem } from '@/hooks/useOpenNavItem'
import { buildNavModel, type MoreDrawerItem, type NavPrimaryCta } from '@/components/navigation/moreDrawerItems'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import { DesktopSessionTree } from '@/components/navigation/DesktopSessionTree'
import {
  Sidebar,
  SidebarSection,
  SidebarItem,
} from '@/components/ui/sidebar'
import { FolderGit2 } from 'lucide-react'

const FOOTER_ITEM_KEYS = new Set(['home', 'settings', 'logout'])

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const openNavItem = useOpenNavItem()
  const [collapsed, toggle] = useSidebarCollapsed()
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

  const handleItemClick = (item: MoreDrawerItem) => {
    if (openNavItem(item)) return
    if (item.key === 'logout') {
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

  const footerItems = items.filter((item) => FOOTER_ITEM_KEYS.has(item.key))
  const collapsedItems: MoreDrawerItem[] = [
    footerItems[0],
    { key: 'repos', label: 'Repos', icon: FolderGit2 },
    ...footerItems.slice(1),
  ]

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggle} className='mt-2'>
        {primary.length > 0 && (
          <SidebarSection collapsed={collapsed}>
            {primary.map((item: NavPrimaryCta) => (
              <SidebarItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                collapsed={collapsed}
                onClick={() => navigate(item.to)}
                asPrimary
                variant={item.variant}
              />
            ))}
          </SidebarSection>
        )}

        {collapsed ? (
          <div className="flex flex-col gap-1 p-2 pt-0">
            {collapsedItems.map((item: MoreDrawerItem) => (
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
            <section aria-label="Sessions" className="flex min-h-0 flex-1 flex-col border-t border-border">
              <h2 className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Sessions</h2>
              <DesktopSessionTree />
            </section>

            <div className="flex gap-1 border-t border-border p-2">
              {footerItems.map((item: MoreDrawerItem) => (
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
