import type { z } from 'zod'

export type GithubFetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

interface GithubRequestHeaders {
  [key: string]: string
}

interface GithubRequestOptions {
  token?: string
  apiVersion?: string
  accept?: string
  signal?: AbortSignal
}

export function githubFetch(
  url: string,
  options: GithubRequestOptions = {},
  fetchFn: GithubFetchFn = fetch,
): Promise<Response> {
  const headers: GithubRequestHeaders = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'User-Agent': 'opencode-manager',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.apiVersion) headers['X-GitHub-Api-Version'] = options.apiVersion
  return fetchFn(url, { headers, signal: options.signal })
}

export async function githubFetchJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  options: GithubRequestOptions = {},
  fetchFn: GithubFetchFn = fetch,
): Promise<z.infer<Schema>> {
  const response = await githubFetch(url, options, fetchFn)
  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`)
  }
  return schema.parse(await response.json())
}

export async function githubFetchBinary(
  url: string,
  options: GithubRequestOptions = {},
  fetchFn: GithubFetchFn = fetch,
): Promise<ArrayBuffer> {
  const response = await githubFetch(url, options, fetchFn)
  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`)
  }
  return response.arrayBuffer()
}
