import { useLocation, useNavigate } from 'react-router-dom'
import { useDesktop } from '@/hooks/useDesktop'
import { useSidebarCollapsed } from '@/hooks/useSidebarCollapsed'
import { useMemoryPluginStatus } from '@/hooks/useMemoryPluginStatus'
import { useAuth } from '@/hooks/useAuth'
import { buildNavModel } from '@/components/navigation/moreDrawerItems'
import {
  Sidebar,
  SidebarSection,
  SidebarItem,
  SidebarCollapseToggle,
} from '@/components/ui/sidebar'
import { LayoutGrid } from 'lucide-react'

export function DesktopSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, toggle] = useSidebarCollapsed()
  const { memoryPluginEnabled } = useMemoryPluginStatus()
  const { isAuthenticated, isLoading, logout } = useAuth()

  const isDesktop = useDesktop()

  if (isLoading || !isAuthenticated) {
    return null
  }

  if (!isDesktop) {
    return null
  }

  const { primary, items } = buildNavModel(location.pathname, { memoryPluginEnabled })

  const handlePrimaryClick = (item: (typeof primary)[number]) => {
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

  const handleItemClick = (item: (typeof items)[number]) => {
    if (item.to) {
      navigate(item.to)
    } else if (item.dialog) {
      const params = new URLSearchParams(location.search)
      params.set('dialog', item.dialog)
      params.delete('mobileTab')
      navigate({ search: params.toString() }, { replace: true })
    } else if (item.key === 'logout') {
      logout()
    } else if (item.key === 'settings') {
      const params = new URLSearchParams(location.search)
      params.set('settings', 'open')
      params.set('tab', 'account')
      navigate({ search: params.toString() }, { replace: true })
    }
  }

  return (
    <Sidebar collapsed={collapsed} onToggle={toggle}>
      <div className="flex items-center justify-between p-2 border-b border-border">
        {!collapsed && (
          <span className="text-sm font-semibold px-2">OpenCode</span>
        )}
        {collapsed && (
          <div className="w-full flex justify-center">
            <LayoutGrid className="h-5 w-5" />
          </div>
        )}
      </div>

      {primary.length > 0 && (
        <SidebarSection collapsed={collapsed}>
          {primary.map((item) => (
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

      <SidebarSection label="Navigation" collapsed={collapsed}>
        {items.map((item) => (
          <SidebarItem
            key={item.key}
            icon={item.icon}
            label={item.label}
            collapsed={collapsed}
            onClick={() => handleItemClick(item)}
            danger={item.danger}
          />
        ))}
      </SidebarSection>

      <div className="mt-auto">
        <SidebarCollapseToggle collapsed={collapsed} onToggle={toggle} />
      </div>
    </Sidebar>
  )
}
