export interface VecSearchResult {
  memoryId: number
  distance: number
}

export type TableDimensionsResult = { exists: boolean; dimensions: number | null }

export interface VecService {
  readonly available: boolean
  initialize(dimensions: number): Promise<void>
  insert(embedding: number[], memoryId: number, projectId: string): Promise<void>
  delete(memoryId: number): Promise<void>
  deleteByProject(projectId: string): Promise<void>
  deleteByMemoryIds(memoryIds: number[]): Promise<void>
  search(embedding: number[], projectId?: string, scope?: string, limit?: number): Promise<VecSearchResult[]>
  findSimilar(embedding: number[], projectId: string, threshold: number, limit: number): Promise<VecSearchResult[]>
  countWithoutEmbeddings(projectId?: string): Promise<number>
  getWithoutEmbeddings(projectId?: string, limit?: number): Promise<Array<{ id: number; content: string }>>
  recreateTable(dimensions: number): Promise<void>
  getDimensions(): Promise<TableDimensionsResult>
  dispose(): void
}
