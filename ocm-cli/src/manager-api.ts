export class ManagerApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, ...extra }
  }

  async mirrorUp(
    repoId: number,
    body: ReadableStream<Uint8Array>,
    opts: { force?: boolean; create?: { name: string; originUrl: string | null; branch: string | null } },
  ): Promise<{ repoId: number; branch: string; head: string; created: boolean }> {
    const params = new URLSearchParams()
    if (opts.force) params.set('force', '1')
    if (opts.create) {
      params.set('create', '1')
      params.set('name', opts.create.name)
      if (opts.create.originUrl) params.set('originUrl', opts.create.originUrl)
      if (opts.create.branch) params.set('branch', opts.create.branch)
    }

    const qs = params.toString() ? `?${params.toString()}` : ''
    const url = `${this.baseUrl}/api/internal/repos/${repoId}/mirror${qs}`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/x-tar',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    if (!res.ok) throw new Error(`mirror ${res.status}: ${await res.text()}`)
    return (await res.json()) as { repoId: number; branch: string; head: string; created: boolean }
  }

  async mirrorDown(repoId: number): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(`${this.baseUrl}/api/internal/repos/${repoId}/mirror`, {
      headers: this.headers(),
    })

    if (!res.ok) throw new Error(`mirror ${res.status}: ${await res.text()}`)
    return res.body!
  }
}
