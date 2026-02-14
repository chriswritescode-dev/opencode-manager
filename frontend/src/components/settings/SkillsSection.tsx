import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Plus, Trash2, Edit, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteDialog } from '@/components/ui/delete-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SkillDialog } from '../skills/SkillDialog'
import { useSkills, useCreateSkill, useUpdateSkill, useDeleteSkill } from '@/hooks/useSkills'
import { listRepos } from '@/api/repos'
import type { Skill } from '@/api/skills'
import type { Repo } from '@/api/types'

export function SkillsSection() {
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>(undefined)
  
  const { data: repos = [] } = useQuery({
    queryKey: ['repos'],
    queryFn: listRepos,
  })
  
  useEffect(() => {
    if (!selectedRepoId && repos.length > 0) {
      setSelectedRepoId(repos[0].id)
    }
  }, [repos, selectedRepoId])
  
  const { data: skills = [], isLoading, error } = useSkills(selectedRepoId)
  const createSkill = useCreateSkill(selectedRepoId)
  const updateSkill = useUpdateSkill(selectedRepoId)
  const deleteSkill = useDeleteSkill(selectedRepoId)
  
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null)
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    skills: true,
  })
  
  const skillsRef = useRef<HTMLButtonElement>(null)
  
  const scrollToSection = (ref: React.RefObject<HTMLButtonElement | null>) => {
    if (ref.current) {
      ref.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'start',
        inline: 'nearest'
      })
    }
  }
  
  const handleCreate = async (data: { name: string; description: string; content: string } | FormData) => {
    if (!selectedRepoId) return
    await createSkill.mutateAsync(data)
    setIsDialogOpen(false)
  }
  
  const handleUpdate = async (data: { name: string; description: string; content: string } | FormData) => {
    if (!editingSkill || !selectedRepoId) return
    await updateSkill.mutateAsync({ name: editingSkill.name, data: data as { name: string; description: string; content: string } })
    setEditingSkill(null)
    setIsDialogOpen(false)
  }
  
  const handleDelete = async () => {
    if (!deletingSkill) return
    await deleteSkill.mutateAsync(deletingSkill.name)
    setDeletingSkill(null)
  }
  
  const openCreateDialog = () => {
    setEditingSkill(null)
    setIsDialogOpen(true)
  }
  
  const openEditDialog = (skill: Skill) => {
    setEditingSkill(skill)
    setIsDialogOpen(true)
  }
  
  const isUpdating = createSkill.isPending || updateSkill.isPending || deleteSkill.isPending
  
  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-lg overflow-hidden min-w-0">
        <button
          ref={skillsRef}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-muted/50 transition-colors min-w-0"
          onClick={() => {
            const isExpanding = !expandedSections.skills
            setExpandedSections(prev => ({ ...prev, skills: isExpanding }))
            if (isExpanding) {
              setTimeout(() => scrollToSection(skillsRef), 100)
            }
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <BookOpen className="h-4 w-4 text-purple-500" />
            <h4 className="text-sm font-medium truncate">Skills</h4>
            <span className="text-xs text-muted-foreground">
              {skills.length} configured
            </span>
          </div>
          <Edit className={`h-4 w-4 transition-transform ${expandedSections.skills ? 'rotate-90' : ''}`} />
        </button>
        
        <div className={`${expandedSections.skills ? 'block' : 'hidden'} border-t border-border`}>
          <div className="p-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <Select
                  value={selectedRepoId?.toString() || ''}
                  onValueChange={(value) => setSelectedRepoId(parseInt(value))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {repos.map((repo: Repo) => {
                      const repoName = repo.repoUrl 
                        ? repo.repoUrl.split('/').pop()?.replace(/\.git$/, '') || repo.repoUrl
                        : repo.localPath.split('/').pop() || repo.localPath
                      return (
                        <SelectItem key={repo.id} value={repo.id.toString()}>
                          {repoName}
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={openCreateDialog}
                disabled={isUpdating || !selectedRepoId}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Skill
              </Button>
            </div>
            
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-8 text-destructive">
                <p>Failed to load skills</p>
              </div>
              ) : skills.length === 0 ? (
              <div className="text-center py-8">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground mb-4">No skills found</p>
                <Button
                  size="sm"
                  onClick={openCreateDialog}
                  disabled={isUpdating || !selectedRepoId}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create your first skill
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {skills.map((skill) => (
                  <Card key={skill.name} className="bg-muted/30">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-sm font-medium">{skill.name}</CardTitle>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(skill)}
                            disabled={isUpdating}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingSkill(skill)}
                            disabled={isUpdating}
                            className="text-red-500 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-sm text-muted-foreground">{skill.description}</p>
                      {skill.updatedAt && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Updated: {new Date(skill.updatedAt).toLocaleString()}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      <SkillDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSave={editingSkill ? handleUpdate : handleCreate}
        skill={editingSkill}
        isUpdating={isUpdating}
      />
      
      <DeleteDialog
        open={!!deletingSkill}
        onOpenChange={() => setDeletingSkill(null)}
        onConfirm={handleDelete}
        onCancel={() => setDeletingSkill(null)}
        title="Delete Skill"
        description="Are you sure you want to delete this skill? The skill file will be removed from the repository."
        itemName={deletingSkill?.name}
        isDeleting={deleteSkill.isPending}
      />
    </div>
  )
}
