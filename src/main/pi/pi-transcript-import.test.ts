import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PI_TRANSCRIPT_IMPORT } from './pi-transcript-import'

let roots: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots = []
})

const accountHome = { variable: 'PI_CODING_AGENT_DIR', path: '/home/u/.pi/agent' }

function requireStore(store: string | null): string {
  if (!store) {
    throw new Error('expected a Pi conversation store')
  }
  return store
}

async function writePiSession(args: {
  sessionsDir: string
  cwd: string
  id: string
}): Promise<string> {
  const dir = join(
    args.sessionsDir,
    `--${args.cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${args.id}.jsonl`)
  await writeFile(
    file,
    `${JSON.stringify({
      type: 'session',
      version: 3,
      id: args.id,
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd: args.cwd
    })}\n`
  )
  return file
}

async function homeWithTwoRoots(): Promise<{
  agentHome: string
  override: string
  cwd: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'orca-pi-import-'))
  roots.push(root)
  const agentHome = join(root, 'agent')
  const override = join(root, 'override')
  const cwd = join(root, 'repo')
  vi.stubEnv('PI_CODING_AGENT_DIR', agentHome)
  vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', override)
  return { agentHome, override, cwd }
}

describe('Pi transcript import across both session roots', () => {
  it('finds a transcript that predates the session-dir override', async () => {
    const { agentHome, override, cwd } = await homeWithTwoRoots()
    const file = await writePiSession({
      sessionsDir: join(agentHome, 'sessions'),
      cwd,
      id: 'old-1'
    })

    const store = requireStore(
      PI_TRANSCRIPT_IMPORT.conversationStore({ accountHome, launchEnv: {} })
    )
    expect(store).toBe(override)

    expect(
      await PI_TRANSCRIPT_IMPORT.findTranscript({
        providerSessionId: 'old-1',
        store,
        launchEnv: {},
        workspaceCwd: cwd
      })
    ).toBe(file)
  })

  it('finds a transcript under the override root', async () => {
    const { agentHome, override, cwd } = await homeWithTwoRoots()
    const file = await writePiSession({ sessionsDir: override, cwd, id: 'new-1' })

    const store = requireStore(
      PI_TRANSCRIPT_IMPORT.conversationStore({ accountHome, launchEnv: {} })
    )
    expect(store).toBe(override)
    expect(join(agentHome, 'sessions')).not.toBe(override)

    expect(
      await PI_TRANSCRIPT_IMPORT.findTranscript({
        providerSessionId: 'new-1',
        store,
        launchEnv: {},
        workspaceCwd: cwd
      })
    ).toBe(file)
  })

  it('admits a transcript under either root and rejects one outside both', async () => {
    const { agentHome, override, cwd } = await homeWithTwoRoots()
    const oldFile = await writePiSession({
      sessionsDir: join(agentHome, 'sessions'),
      cwd,
      id: 'old-1'
    })
    const newFile = await writePiSession({ sessionsDir: override, cwd, id: 'new-1' })
    const outside = await writePiSession({ sessionsDir: join(roots[0], 'elsewhere'), cwd, id: 'x' })

    const store = requireStore(
      PI_TRANSCRIPT_IMPORT.conversationStore({ accountHome, launchEnv: {} })
    )
    expect(await PI_TRANSCRIPT_IMPORT.admitTranscriptPath({ store, transcriptPath: oldFile })).toBe(
      await realpath(oldFile)
    )
    expect(await PI_TRANSCRIPT_IMPORT.admitTranscriptPath({ store, transcriptPath: newFile })).toBe(
      await realpath(newFile)
    )
    expect(
      await PI_TRANSCRIPT_IMPORT.admitTranscriptPath({ store, transcriptPath: outside })
    ).toBeNull()
  })

  it('keeps admission inside the single store when no related root is declared', async () => {
    const { agentHome, override, cwd } = await homeWithTwoRoots()
    const oldFile = await writePiSession({
      sessionsDir: join(agentHome, 'sessions'),
      cwd,
      id: 'old-1'
    })
    // A relative override is refused outright, so only the agent home is recognised.
    vi.stubEnv('PI_CODING_AGENT_SESSION_DIR', 'rel/path')

    const store = requireStore(
      PI_TRANSCRIPT_IMPORT.conversationStore({ accountHome, launchEnv: {} })
    )
    expect(store).toBe(join(agentHome, 'sessions'))
    expect(await PI_TRANSCRIPT_IMPORT.admitTranscriptPath({ store, transcriptPath: oldFile })).toBe(
      await realpath(oldFile)
    )
    // The override root is not recognised here, so its transcript must be refused.
    const overrideFile = await writePiSession({ sessionsDir: override, cwd, id: 'new-1' })
    expect(
      await PI_TRANSCRIPT_IMPORT.admitTranscriptPath({ store, transcriptPath: overrideFile })
    ).toBeNull()
  })
})
