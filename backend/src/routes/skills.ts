import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import * as db from '../db/queries'
import { promises as fs } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { logger } from '../utils/logger'
import { getErrorMessage, getStatusCode } from '../utils/error-utils'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .replace(/-+/g, '-')
}

function getSkillsDir(repoLocalPath: string): string {
  return path.join(repoLocalPath, '.opencode', 'skills')
}

function getSkillPath(repoLocalPath: string, skillName: string): string {
  return path.join(getSkillsDir(repoLocalPath), skillName, 'SKILL.md')
}

interface Skill {
  name: string
  description: string
  content: string
  location: string
  createdAt?: number
  updatedAt?: number
}

async function parseSkillFile(skillPath: string): Promise<Skill | null> {
  try {
    const content = await fs.readFile(skillPath, 'utf8')
    const { data, content: markdown } = matter(content)
    
    const name = data.name
    const description = data.description
    
    if (!name || !description) {
      return null
    }
    
    const stats = await fs.stat(skillPath)
    
    return {
      name,
      description,
      content: markdown.trim(),
      location: skillPath,
      createdAt: stats.birthtimeMs,
      updatedAt: stats.mtimeMs,
    }
  } catch (error) {
    logger.error(`Failed to parse skill file ${skillPath}:`, error)
    return null
  }
}

async function listSkillsForRepo(repoLocalPath: string): Promise<Skill[]> {
  const skillsDir = getSkillsDir(repoLocalPath)
  
  try {
    await fs.access(skillsDir)
  } catch {
    return []
  }
  
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    const skills: Skill[] = []
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md')
      
      try {
        await fs.access(skillPath)
      } catch {
        continue
      }
      
      const skill = await parseSkillFile(skillPath)
      if (skill) {
        skills.push(skill)
      }
    }
    
    return skills.sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    logger.error(`Failed to list skills in ${skillsDir}:`, error)
    return []
  }
}

async function createSkillFile(repoLocalPath: string, name: string, description: string, content: string): Promise<Skill> {
  const slug = slugify(name)
  const skillDir = path.join(getSkillsDir(repoLocalPath), slug)
  const skillPath = path.join(skillDir, 'SKILL.md')
  
  await fs.mkdir(skillDir, { recursive: true })
  
  const frontmatter = `---
name: ${slug}
description: ${description}
---
`
  const fileContent = frontmatter + content
  
  await fs.writeFile(skillPath, fileContent, 'utf8')
  logger.info(`Created skill '${slug}' at ${skillPath}`)
  
  const stats = await fs.stat(skillPath)
  
  return {
    name: slug,
    description,
    content,
    location: skillPath,
    createdAt: stats.birthtimeMs,
    updatedAt: stats.mtimeMs,
  }
}

async function updateSkillFile(repoLocalPath: string, currentName: string, updates: { name?: string; description?: string; content?: string }): Promise<Skill> {
  const oldPath = getSkillPath(repoLocalPath, currentName)
  
  const content = await fs.readFile(oldPath, 'utf8')
  const { data } = matter(content)
  
  const newName = updates.name ? slugify(updates.name) : currentName
  const newDescription = updates.description || data.description || ''
  const newContent = updates.content !== undefined ? updates.content : content.split('---').slice(2).join('---').trim()
  
  if (newName !== currentName) {
    const newDir = path.join(getSkillsDir(repoLocalPath), newName)
    const newPath = path.join(newDir, 'SKILL.md')
    
    await fs.mkdir(newDir, { recursive: true })
    await fs.writeFile(newPath, matter.stringify(newContent, { name: newName, description: newDescription }), 'utf8')
    await fs.rm(oldPath, { recursive: true })
    
    logger.info(`Renamed skill from '${currentName}' to '${newName}'`)
    
    const stats = await fs.stat(newPath)
    return {
      name: newName,
      description: newDescription,
      content: newContent,
      location: newPath,
      createdAt: stats.birthtimeMs,
      updatedAt: stats.mtimeMs,
    }
  }
  
  const frontmatter = `---
name: ${newName}
description: ${newDescription}
---
`
  await fs.writeFile(oldPath, frontmatter + newContent, 'utf8')
  logger.info(`Updated skill '${currentName}'`)
  
  const stats = await fs.stat(oldPath)
  return {
    name: newName,
    description: newDescription,
    content: newContent,
    location: oldPath,
    createdAt: stats.birthtimeMs,
    updatedAt: stats.mtimeMs,
  }
}

async function deleteSkillFile(repoLocalPath: string, name: string): Promise<void> {
  const skillDir = path.join(getSkillsDir(repoLocalPath), name)
  
  await fs.rm(skillDir, { recursive: true })
  logger.info(`Deleted skill '${name}' at ${skillDir}`)
}

export function createSkillsRoutes(database: Database) {
  const app = new Hono()
  
  app.get('/:repoId', async (c) => {
    try {
      const repoId = parseInt(c.req.param('repoId'))
      
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repository ID' }, 400)
      }
      
      const repo = db.getRepoById(database, repoId)
      
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }
      
      const skills = await listSkillsForRepo(repo.localPath)
      
      return c.json({ skills })
    } catch (error) {
      logger.error('Failed to list skills:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })
  
  app.post('/:repoId', async (c) => {
    try {
      const repoId = parseInt(c.req.param('repoId'))
      
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repository ID' }, 400)
      }
      
      const repo = db.getRepoById(database, repoId)
      
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }
      
      const contentType = c.req.header('content-type') || ''
      
      if (contentType.includes('multipart/form-data')) {
        const formData = await c.req.parseMultipartFormData()
        
        const file = formData.get('file')
        
        if (file) {
          const fileContent = typeof file.content === 'string' 
            ? file.content 
            : Buffer.from(file.content).toString('utf8')
          
          const fileName = file.filename || 'skill.md'
          const baseName = path.basename(fileName, path.extname(fileName))
          
          let name = formData.get('name')?.toString() || slugify(baseName)
          let description = formData.get('description')?.toString() || ''
          let skillContent = fileContent
          
          const { data, content: markdown } = matter(fileContent)
          
          if (data.name) {
            name = data.name
          }
          if (data.description) {
            description = data.description
          }
          if (markdown.trim()) {
            skillContent = markdown.trim()
          }
          
          if (!name) {
            return c.json({ error: 'Skill name is required' }, 400)
          }
          if (!description) {
            return c.json({ error: 'Skill description is required' }, 400)
          }
          if (!skillContent) {
            return c.json({ error: 'Skill content is required' }, 400)
          }
          
          const skill = await createSkillFile(repo.localPath, name, description, skillContent)
          return c.json(skill, 201)
        }
      }
      
      const body = await c.req.json()
      const { name, description, content } = body
      
      if (!name) {
        return c.json({ error: 'Skill name is required' }, 400)
      }
      if (!description) {
        return c.json({ error: 'Skill description is required' }, 400)
      }
      if (!content) {
        return c.json({ error: 'Skill content is required' }, 400)
      }
      
      const skill = await createSkillFile(repo.localPath, name, description, content)
      
      return c.json(skill, 201)
    } catch (error) {
      logger.error('Failed to create skill:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })
  
  app.put('/:repoId/:name', async (c) => {
    try {
      const repoId = parseInt(c.req.param('repoId'))
      const skillName = c.req.param('name')
      
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repository ID' }, 400)
      }
      
      if (!skillName) {
        return c.json({ error: 'Skill name is required' }, 400)
      }
      
      const repo = db.getRepoById(database, repoId)
      
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }
      
      const body = await c.req.json()
      const { name, description, content } = body
      
      const updates: { name?: string; description?: string; content?: string } = {}
      
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (content !== undefined) updates.content = content
      
      if (Object.keys(updates).length === 0) {
        return c.json({ error: 'No updates provided' }, 400)
      }
      
      const skill = await updateSkillFile(repo.localPath, skillName, updates)
      
      return c.json(skill)
    } catch (error) {
      logger.error('Failed to update skill:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })
  
  app.delete('/:repoId/:name', async (c) => {
    try {
      const repoId = parseInt(c.req.param('repoId'))
      const skillName = c.req.param('name')
      
      if (isNaN(repoId)) {
        return c.json({ error: 'Invalid repository ID' }, 400)
      }
      
      if (!skillName) {
        return c.json({ error: 'Skill name is required' }, 400)
      }
      
      const repo = db.getRepoById(database, repoId)
      
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404)
      }
      
      await deleteSkillFile(repo.localPath, skillName)
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete skill:', error)
      return c.json({ error: getErrorMessage(error) }, getStatusCode(error) as ContentfulStatusCode)
    }
  })
  
  return app
}
