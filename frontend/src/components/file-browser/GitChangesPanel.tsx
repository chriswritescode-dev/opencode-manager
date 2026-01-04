import { useState, useMemo } from 'react'
import { useGitStatus } from '@/api/git'
import { Loader2, FileText, FilePlus, FileX, FileEdit, File, ChevronRight, ChevronDown, ArrowUp, ArrowDown, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GitFileStatus, GitFileStatusType } from '@/types/git'

interface GitChangesPanelProps {
  repoId: number
  onFileSelect: (path: string) => void
  selectedFile?: string
}

interface GitTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children: GitTreeNode[]
  file?: GitFileStatus
  fileCount: number
  statusCounts: Partial<Record<GitFileStatusType, number>>
}

const statusConfig: Record<GitFileStatusType, { icon: typeof FileText; color: string; label: string }> = {
  modified: { icon: FileEdit, color: 'text-yellow-500', label: 'Modified' },
  added: { icon: FilePlus, color: 'text-green-500', label: 'Added' },
  deleted: { icon: FileX, color: 'text-red-500', label: 'Deleted' },
  renamed: { icon: FileText, color: 'text-blue-500', label: 'Renamed' },
  untracked: { icon: File, color: 'text-muted-foreground', label: 'Untracked' },
  copied: { icon: FileText, color: 'text-purple-500', label: 'Copied' },
}

function buildTree(files: GitFileStatus[]): GitTreeNode[] {
  const root: GitTreeNode[] = []
  const nodeMap = new Map<string, GitTreeNode>()

  for (const file of files) {
    const isDirectoryPath = file.path.endsWith('/')
    const cleanPath = isDirectoryPath ? file.path.slice(0, -1) : file.path
    const parts = cleanPath.split('/').filter(p => p)
    
    if (parts.length === 0) continue
    
    let currentPath = ''
    let currentLevel = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      let node = nodeMap.get(currentPath)
      if (!node) {
        const isDir = !isLast || isDirectoryPath
        node = {
          name: part,
          path: currentPath,
          isDirectory: isDir,
          children: [],
          file: (isLast && !isDirectoryPath) ? file : undefined,
          fileCount: 0,
          statusCounts: isDirectoryPath && isLast ? { [file.status]: 1 } : {},
        }
        nodeMap.set(currentPath, node)
        currentLevel.push(node)
      } else if (isLast && isDirectoryPath) {
        node.statusCounts[file.status] = (node.statusCounts[file.status] || 0) + 1
      }

      if (isLast && !isDirectoryPath) {
        node.file = file
        node.isDirectory = false
      }

      currentLevel = node.children
    }
  }

  function aggregateCounts(node: GitTreeNode): void {
    if (node.isDirectory) {
      const existingCounts = { ...node.statusCounts }
      node.fileCount = 0
      node.statusCounts = {}
      
      if (node.children.length === 0) {
        node.statusCounts = existingCounts
        node.fileCount = Object.values(existingCounts).reduce((a, b) => a + (b || 0), 0) || 1
      } else {
        for (const child of node.children) {
          aggregateCounts(child)
          node.fileCount += child.isDirectory ? child.fileCount : 1
          for (const [status, count] of Object.entries(child.statusCounts)) {
            node.statusCounts[status as GitFileStatusType] = 
              (node.statusCounts[status as GitFileStatusType] || 0) + (count as number)
          }
          if (child.file) {
            node.statusCounts[child.file.status] = 
              (node.statusCounts[child.file.status] || 0) + 1
          }
        }
      }
    }
  }

  function sortNodes(nodes: GitTreeNode[]): GitTreeNode[] {
    return nodes.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    }).map(node => ({
      ...node,
      children: sortNodes(node.children)
    }))
  }

  for (const node of root) {
    aggregateCounts(node)
  }

  return sortNodes(root)
}

function filterTree(nodes: GitTreeNode[], filter: GitFileStatusType | 'all'): GitTreeNode[] {
  if (filter === 'all') return nodes

  return nodes
    .map(node => {
      if (node.isDirectory) {
        const filteredChildren = filterTree(node.children, filter)
        if (filteredChildren.length === 0) return null
        return { ...node, children: filteredChildren }
      }
      return node.file?.status === filter ? node : null
    })
    .filter((node): node is GitTreeNode => node !== null)
}

interface GitTreeNodeItemProps {
  node: GitTreeNode
  level: number
  selectedFile?: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

function GitTreeNodeItem({ node, level, selectedFile, expandedPaths, onToggle, onSelect }: GitTreeNodeItemProps) {
  const isExpanded = expandedPaths.has(node.path)
  const isSelected = selectedFile === node.path

  if (node.isDirectory) {
    const statusEntries = Object.entries(node.statusCounts) as [GitFileStatusType, number][]
    const dominantStatus = statusEntries.length > 0 
      ? statusEntries.reduce((a, b) => a[1] > b[1] ? a : b)[0]
      : null

    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-md'
          )}
          style={{ paddingLeft: `${level * 12 + 12}px` }}
        >
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </span>
          {isExpanded ? (
            <FolderOpen className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-sm text-foreground truncate flex-1">{node.name}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            {dominantStatus && (
              <span className={cn('text-[10px] px-1 py-0.5 rounded', statusConfig[dominantStatus].color)}>
                {node.fileCount}
              </span>
            )}
          </div>
        </button>
        {isExpanded && (
          <div>
            {node.children.map(child => (
              <GitTreeNodeItem
                key={child.path}
                node={child}
                level={level + 1}
                selectedFile={selectedFile}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  const file = node.file!
  const config = statusConfig[file.status]
  const Icon = config.icon

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 transition-colors rounded-md',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft: `${level * 12 + 12}px` }}
    >
      <span className="w-4 h-4 flex-shrink-0" />
      <Icon className={cn('w-4 h-4 flex-shrink-0', config.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm text-foreground truncate">{node.name}</span>
          {file.staged && (
            <span className="text-[10px] px-1 py-0.5 bg-green-500/20 text-green-500 rounded">staged</span>
          )}
        </div>
        {file.oldPath && (
          <span className="text-xs text-muted-foreground truncate block">← {file.oldPath}</span>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
    </button>
  )
}

export function GitChangesPanel({ repoId, onFileSelect, selectedFile }: GitChangesPanelProps) {
  const { data: status, isLoading, error } = useGitStatus(repoId)
  const [filter, setFilter] = useState<GitFileStatusType | 'all'>('all')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const tree = useMemo(() => {
    if (!status?.files) return []
    return buildTree(status.files)
  }, [status?.files])

  const filteredTree = useMemo(() => {
    return filterTree(tree, filter)
  }, [tree, filter])

  const handleToggle = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p className="text-sm">Failed to load git status</p>
        <p className="text-xs mt-1">{error.message}</p>
      </div>
    )
  }

  if (!status || !status.hasChanges) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No uncommitted changes</p>
      </div>
    )
  }

  const statusCounts = status.files.reduce((acc, file) => {
    acc[file.status] = (acc[file.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">{status.branch}</span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status.ahead > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="w-3 h-3" />
                {status.ahead}
              </span>
            )}
            {status.behind > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="w-3 h-3" />
                {status.behind}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'text-xs px-2 py-0.5 rounded transition-colors',
              filter === 'all' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            All ({status.files.length})
          </button>
          {Object.entries(statusCounts).map(([statusKey, count]) => {
            const config = statusConfig[statusKey as GitFileStatusType]
            return (
              <button
                key={statusKey}
                onClick={() => setFilter(statusKey as GitFileStatusType)}
                className={cn(
                  'text-xs px-2 py-0.5 rounded transition-colors',
                  filter === statusKey ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <span className={config.color}>{config.label}</span> ({count})
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-0.5 pb-8">
          {filteredTree.map((node) => (
            <GitTreeNodeItem
              key={node.path}
              node={node}
              level={0}
              selectedFile={selectedFile}
              expandedPaths={expandedPaths}
              onToggle={handleToggle}
              onSelect={onFileSelect}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
