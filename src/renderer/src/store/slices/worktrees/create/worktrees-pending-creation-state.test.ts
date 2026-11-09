import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../../types'
import type { PendingWorktreeCreation } from '@/lib/workspace/creation/pending-worktree-creation'
import { makeWorktree } from '../worktree.test-fixture'
import {
  createTestStore,
  mockApi,
  resetRemoteRuntimeMocks,
  resetWorktreeSliceModuleMemory
} from '../worktrees-slice-test-harness'
import {
  hideVmCreateCheckout,
  readHiddenVmCheckouts,
  releaseVmCreateCheckout
} from '@/lib/vm-create-hidden-checkouts'

const requestWorktreeBaseFallbackNotice = vi.hoisted(() => vi.fn())

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn()
  }
}))

vi.mock('@/components/worktree-base-fallback-notice', () => ({
  requestWorktreeBaseFallbackNotice
}))

beforeEach(() => {
  resetWorktreeSliceModuleMemory()
  for (const creationId of readHiddenVmCheckouts().keys()) {
    releaseVmCreateCheckout(creationId)
  }
})

function makePendingCreation(
  creationId: string,
  overrides: Partial<PendingWorktreeCreation> = {}
): PendingWorktreeCreation {
  return {
    creationId,
    phase: 'fetching',
    status: 'creating',
    startedAt: 1000,
    indeterminate: false,
    loaderVisible: false,
    request: {
      repoId: 'repo1',
      name: 'feature',
      setupDecision: 'inherit',
      agent: null,
      pendingFirstAgentMessageRename: false,
      note: '',
      startupPlan: null,
      quickPrompt: '',
      quickTelemetry: null
    },
    ...overrides
  }
}

describe('pending worktree creation state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetRemoteRuntimeMocks()
  })

  it('keeps composer picks when stale preparation lands without prior chat options', () => {
    const store = createTestStore()
    const request = {
      ...makePendingCreation('c1').request,
      agent: 'codex' as const,
      launchInputs: {
        sessionOptions: { effort: 'high', permissionMode: 'ask' }
      }
    }
    store.getState().beginPendingWorktreeCreation(makePendingCreation('c1', { request }))
    store.getState().updatePendingWorktreeCreation('c1', {
      chatSessionOptions: { effort: 'low' }
    })
    store.getState().updatePendingWorktreeCreation('c1', {
      chatSessionOptions: { fastMode: 'true' }
    })

    store.getState().updatePendingWorktreeCreation('c1', {
      request: {
        ...request,
        setupDecision: 'skip',
        hookPreparation: undefined,
        executionHostId: 'runtime:host-1',
        launchInputs: { ...request.launchInputs, agentArgs: '--sandbox workspace-write' }
      },
      phase: 'creating'
    })

    const current = store.getState().pendingWorktreeCreations.c1
    expect(current?.request).toMatchObject({
      setupDecision: 'skip',
      executionHostId: 'runtime:host-1',
      launchInputs: {
        sessionOptions: { effort: 'high', permissionMode: 'ask' },
        agentArgs: '--sandbox workspace-write',
        chatSessionOptions: { effort: 'low', fastMode: 'true' }
      }
    })
    expect(current?.request.launchInputs?.chatSessionOptions?.model).toBeUndefined()
    expect(current?.phase).toBe('creating')
  })

  it('keeps composer picks when stale preparation lands with prior chat options', () => {
    const store = createTestStore()
    const request = {
      ...makePendingCreation('c1').request,
      agent: 'codex' as const,
      launchInputs: {
        sessionOptions: { effort: 'high', permissionMode: 'ask' },
        chatSessionOptions: { effort: 'high' }
      }
    }
    store.getState().beginPendingWorktreeCreation(makePendingCreation('c1', { request }))
    store.getState().updatePendingWorktreeCreation('c1', {
      chatSessionOptions: { effort: 'low' }
    })
    store.getState().updatePendingWorktreeCreation('c1', {
      chatSessionOptions: { fastMode: 'true' }
    })

    store.getState().updatePendingWorktreeCreation('c1', {
      request: {
        ...request,
        setupDecision: 'skip',
        hookPreparation: undefined,
        executionHostId: 'runtime:host-1',
        launchInputs: { ...request.launchInputs, agentArgs: '--sandbox workspace-write' }
      },
      phase: 'creating'
    })

    const current = store.getState().pendingWorktreeCreations.c1
    expect(current?.request).toMatchObject({
      setupDecision: 'skip',
      executionHostId: 'runtime:host-1',
      launchInputs: {
        sessionOptions: { effort: 'high', permissionMode: 'ask' },
        agentArgs: '--sandbox workspace-write',
        chatSessionOptions: { effort: 'low', fastMode: 'true' }
      }
    })
    expect(current?.request.launchInputs?.chatSessionOptions?.model).toBeUndefined()
    expect(current?.phase).toBe('creating')
  })

  it('removePendingWorktreeCreation cleans up a provisioned-root setup and VM runtime', async () => {
    const store = createTestStore()
    const deleteProjectHostSetup = vi.mocked(store.getState().deleteProjectHostSetup)
    deleteProjectHostSetup.mockResolvedValue({ setup: { id: 'setup-1' } } as never)
    store.getState().beginPendingWorktreeCreation(
      makePendingCreation('c1', {
        phase: 'fetching',
        request: {
          ...makePendingCreation('c1').request,
          ephemeralVmRuntimeId: 'runtime-1',
          ephemeralVmCheckoutMode: 'provisioned-root',
          workspaceRunContext: {
            kind: 'workspace-run',
            projectId: 'project-1',
            hostId: 'ssh:runtime-ssh-1',
            projectHostSetupId: 'setup-1',
            repoId: 'repo-1',
            path: '/workspace/repo'
          }
        }
      })
    )

    store.getState().removePendingWorktreeCreation('c1')

    expect(deleteProjectHostSetup).toHaveBeenCalledWith({
      setupId: 'setup-1',
      hostId: 'ssh:runtime-ssh-1'
    })
    await vi.waitFor(() =>
      expect(mockApi.ephemeralVm.cleanup).toHaveBeenCalledWith({ runtimeId: 'runtime-1' })
    )
    expect(store.getState().pendingWorktreeCreations.c1).toBeUndefined()
  })

  it('removePendingWorktreeCreation can drop a completed VM creation without cleanup', () => {
    const store = createTestStore()
    store.getState().beginPendingWorktreeCreation(
      makePendingCreation('c1', {
        phase: 'fetching',
        request: {
          ...makePendingCreation('c1').request,
          ephemeralVmRuntimeId: 'runtime-1'
        }
      })
    )

    hideVmCreateCheckout('c1', { repoId: 'vm-repo', path: '/workspace/repo' })
    store.getState().removePendingWorktreeCreation('c1', { cleanupVm: false })

    expect(mockApi.ephemeralVm.cleanup).not.toHaveBeenCalled()
    expect(store.getState().pendingWorktreeCreations.c1).toBeUndefined()
    expect(readHiddenVmCheckouts().has('c1')).toBe(false)
  })

  it('keeps a cancelled VM checkout hidden once cleaned up, and shows it if cleanup fails', async () => {
    const store = createTestStore()
    const request = {
      ...makePendingCreation('c1').request,
      ephemeralVmRuntimeId: 'runtime-1'
    }
    store.getState().beginPendingWorktreeCreation(makePendingCreation('c1', { request }))
    hideVmCreateCheckout('c1', { repoId: 'vm-repo', path: '/workspace/repo' })
    store.getState().removePendingWorktreeCreation('c1')
    await vi.waitFor(() => expect(mockApi.ephemeralVm.cleanup).toHaveBeenCalled())
    await Promise.resolve()
    expect(readHiddenVmCheckouts().has('c1')).toBe(true)

    mockApi.ephemeralVm.cleanup.mockRejectedValueOnce(new Error('destroy failed'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    store
      .getState()
      .beginPendingWorktreeCreation(makePendingCreation('c2', { request: { ...request } }))
    hideVmCreateCheckout('c2', { repoId: 'vm-repo-2', path: '/workspace/repo' })
    store.getState().removePendingWorktreeCreation('c2')
    await vi.waitFor(() => expect(readHiddenVmCheckouts().has('c2')).toBe(false))
    errorSpy.mockRestore()
  })

  it('setActiveWorktree dismisses the creation panel even when re-selecting the already-active worktree', () => {
    const store = createTestStore()
    const wt = makeWorktree({ id: 'repo1::/path/a', repoId: 'repo1' })
    store.setState({
      worktreesByRepo: { repo1: [wt] },
      activeWorktreeId: wt.id,
      activePendingCreationId: 'c1',
      pendingWorktreeCreations: { c1: makePendingCreation('c1') }
    } as unknown as Partial<AppState>)

    store.getState().setActiveWorktree(wt.id)

    expect(store.getState().activePendingCreationId).toBeNull()
  })
})
