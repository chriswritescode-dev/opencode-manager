export type GithubFetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>

interface GithubRequestOptions {
  token?: string
  apiVersion?: string
  accept?: string
}

export function githubFetch(
  url: string,
  options: GithubRequestOptions = {},
  fetchFn: GithubFetchFn = fetch,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: options.accept ?? 'application/vnd.github+json',
    'User-Agent': 'opencode-manager',
  }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.apiVersion) headers['X-GitHub-Api-Version'] = options.apiVersion
  return fetchFn(url, { headers })
}

export async function githubFetchJson<T = unknown>(
  url: string,
  options: GithubRequestOptions = {},
  fetchFn: GithubFetchFn = fetch,
): Promise<T> {
  const response = await githubFetch(url, options, fetchFn)
  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
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
