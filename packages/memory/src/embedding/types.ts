export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>
  readonly dimensions: number
  readonly name: string
  readonly ready: boolean
  test(): Promise<boolean>
  warmup(): void
  dispose?(): void
}
