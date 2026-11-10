import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import type { AiVaultSession } from '../../src/shared/ai-vault/contracts/ai-vault-types'

// Both Pi roots are pinned before launch: the agent home Pi falls back to, and an explicit
// session-dir override. Transcripts written before the override must stay discoverable.
const roots = mkdtempSync(path.join(tmpdir(), 'orca-pi-two-roots-'))
const agentHome = path.join(roots, 'agent')
const overrideRoot = path.join(roots, 'override')
const outsideRoot = path.join(roots, 'outside')

test.use({
  launchEnv: {
    PI_CODING_AGENT_DIR: agentHome,
    PI_CODING_AGENT_SESSION_DIR: overrideRoot
  }
})

/** Pi names a project directory after its cwd, with separators and colons replaced by dashes. */
function projectDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
}

function seedPiSession(args: {
  sessionsDir: string
  cwd: string
  id: string
  prompt: string
}): string {
  const dir = path.join(args.sessionsDir, projectDirName(args.cwd))
  mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${args.id}.jsonl`)
  const timestamp = new Date().toISOString()
  writeFileSync(
    filePath,
    `${[
      JSON.stringify({ type: 'session', version: 3, id: args.id, timestamp, cwd: args.cwd }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        timestamp,
        message: { role: 'user', content: args.prompt }
      })
    ].join('\n')}\n`
  )
  return filePath
}

async function listPiSessions(page: Page): Promise<AiVaultSession[]> {
  const sessions = await page.evaluate(async () => {
    const result = await window.api.aiVault.listSessions({
      executionHostScope: 'local',
      force: true
    })
    return result.sessions
  })
  return sessions.filter((session) => session.agent === 'pi')
}

test.describe('Pi sessions under both recognised roots', () => {
  test('lists a transcript the override no longer writes to, and resumes it by path', async ({
    orcaPage,
    seededRepoPath
  }) => {
    const filePath = seedPiSession({
      sessionsDir: path.join(agentHome, 'sessions'),
      cwd: seededRepoPath,
      id: 'pre-override-1',
      prompt: 'kept in the agent home before the override'
    })

    const session = (await listPiSessions(orcaPage)).find(
      (candidate) => candidate.sessionId === 'pre-override-1'
    )

    expect(session, 'the agent-home transcript must stay discoverable').toBeTruthy()
    expect(session?.filePath).toBe(filePath)
    // Pi resolves an ID against its default store, so the resume line must name the transcript.
    expect(session?.resumeCommand).toContain(filePath)
  })

  test('lists a transcript written under the override root', async ({
    orcaPage,
    seededRepoPath
  }) => {
    const filePath = seedPiSession({
      sessionsDir: overrideRoot,
      cwd: seededRepoPath,
      id: 'override-1',
      prompt: 'written after the override took effect'
    })

    const session = (await listPiSessions(orcaPage)).find(
      (candidate) => candidate.sessionId === 'override-1'
    )

    expect(session, 'the override transcript must be discoverable').toBeTruthy()
    expect(session?.filePath).toBe(filePath)
  })

  test('ignores a transcript outside both recognised roots', async ({
    orcaPage,
    seededRepoPath
  }) => {
    seedPiSession({
      sessionsDir: outsideRoot,
      cwd: seededRepoPath,
      id: 'outside-1',
      prompt: 'not under any recognised root'
    })

    const sessions = await listPiSessions(orcaPage)

    expect(sessions.some((session) => session.sessionId === 'outside-1')).toBe(false)
  })
})
