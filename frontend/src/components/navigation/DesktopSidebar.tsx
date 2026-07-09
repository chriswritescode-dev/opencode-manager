import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useAuth } from '@/hooks/useAuth'
import { useUrlParams } from '@/hooks/useUrlParams'
import { buildNavModel, type MoreDrawerItem, type NavPrimaryCta } from '@/components/navigation/moreDrawerItems'
import { getPathWithReturnTo } from '@/lib/navigation'
import { RepoQuickSwitchSheet } from '@/components/navigation/RepoQuickSwitchSheet'
import {
  Sidebar,
  SidebarSection,
  SidebarItem,
  SidebarCollapseToggle,
} from '@/components/ui/sidebar'
import { FolderGit2 } from 'lucide-react'

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { updateParams } = useUrlParams()
  const [collapsed, toggle] = useSidebarCollapsed()
  const [repoSwitcherOpen, setRepoSwitcherOpen] = useState(false)
  const { isAuthenticated, isLoading, logout } = useAuth()
  const { t } = useTranslation()

  const isDesktop = useDesktop()

  if (isLoading || !isAuthenticated) {
    return null
  }

  if (!isDesktop) {
    return null
  }

  const { primary, items } = buildNavModel(location.pathname, t)

  const handlePrimaryClick = (item: NavPrimaryCta) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.onSelect) {
      window.dispatchEvent(
        new CustomEvent('oc:sidebar:action', {
          detail: { action: item.onSelect },
        })
      )
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

  const navItems: MoreDrawerItem[] = [
    { key: 'repos', label: t('nav.repos'), icon: FolderGit2 },
    ...items,
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
                onClick={() => handlePrimaryClick(item)}
                asPrimary
                variant={item.variant}
              />
            ))}
          </SidebarSection>
        )}

        <div className="flex items-center justify-between px-2 py-1.5">
          {!collapsed && (
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('nav.navigation')}
            </div>
          )}
          <SidebarCollapseToggle collapsed={collapsed} onToggle={toggle} />
        </div>

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
      </Sidebar>

      <RepoQuickSwitchSheet
        isOpen={repoSwitcherOpen}
        onClose={() => setRepoSwitcherOpen(false)}
      />
    </>
  )
}
