export interface ReplaceOpenCodeConfigDirectoryResult {
  configSourceFilename: string
  filesInstalled: string[]
  skippedPaths: string[]
  preservedEntries: string[]
  executablesRestored: string[]
}
