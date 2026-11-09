import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_SIDEBAR_FEED_DOMAINS } from '../../../shared/sidebar-feed-client/sidebar-feed-snapshot'
import type { SidebarFeedDomains } from '../../../shared/sidebar-list/sidebar-feed-domains'
import {
  hideVmCreateCheckout,
  readHiddenVmCheckouts,
  releaseVmCreateCheckout,
  subscribeHiddenVmCheckouts,
  withoutHiddenVmCheckouts,
  withoutHiddenVmWorktrees
} from './vm-create-hidden-checkouts'

type Row = { repoId: string; path: string; isMainWorktree?: boolean }

function domainsWith(workspaces: Row[], pairedServerRows: Row[]): SidebarFeedDomains {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the filter reads only repoId, path and isMainWorktree.
  return {
    ...EMPTY_SIDEBAR_FEED_DOMAINS,
    workspaces: new Map(workspaces.map((row, i) => [`w${i}`, row])),
    pairedServerRows: new Map(pairedServerRows.map((row, i) => [`p${i}`, row]))
  } as unknown as SidebarFeedDomains
}

afterEach(() => {
  for (const creationId of readHiddenVmCheckouts().keys()) {
    releaseVmCreateCheckout(creationId)
  }
})

describe('withoutHiddenVmCheckouts', () => {
  it('drops only the VM primary checkout while its create is in progress', () => {
    const vmPrimary = { repoId: 'vm-repo', path: '/srv/repo', isMainWorktree: true }
    const vmLinked = { repoId: 'vm-repo', path: '/srv/repo-wt', isMainWorktree: false }
    const sameRepoIdElsewhere = { repoId: 'vm-repo', path: '/other', isMainWorktree: true }
    const local = { repoId: 'local', path: '/srv/repo', isMainWorktree: true }
    const domains = domainsWith([local], [vmPrimary, vmLinked, sameRepoIdElsewhere])

    hideVmCreateCheckout('c1', { repoId: 'vm-repo', path: '/srv/repo/' })
    const filtered = withoutHiddenVmCheckouts(domains, readHiddenVmCheckouts())

    expect([...filtered.pairedServerRows.values()]).toEqual([vmLinked, sameRepoIdElsewhere])
    expect(filtered.workspaces).toBe(domains.workspaces)
  })

  it('keeps the same domains object when nothing is hidden or nothing matches', () => {
    const domains = domainsWith([{ repoId: 'a', path: '/a' }], [])
    expect(withoutHiddenVmCheckouts(domains, readHiddenVmCheckouts())).toBe(domains)
    hideVmCreateCheckout('c1', { repoId: 'b', path: '/b' })
    expect(withoutHiddenVmCheckouts(domains, readHiddenVmCheckouts())).toBe(domains)
  })

  it('shows the checkout again once released, and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeHiddenVmCheckouts(listener)
    const domains = domainsWith([{ repoId: 'vm', path: '/r', isMainWorktree: true }], [])

    hideVmCreateCheckout('c1', { repoId: 'vm', path: '/r' })
    expect(withoutHiddenVmCheckouts(domains, readHiddenVmCheckouts()).workspaces.size).toBe(0)
    releaseVmCreateCheckout('c1')
    releaseVmCreateCheckout('c1')

    expect(withoutHiddenVmCheckouts(domains, readHiddenVmCheckouts())).toBe(domains)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})

describe('withoutHiddenVmWorktrees', () => {
  it('drops the hidden VM primary checkout from the window list and keeps identity otherwise', () => {
    const vmPrimary = { id: 'vm', repoId: 'vm-repo', path: '/srv/repo', isMainWorktree: true }
    const other = { id: 'o', repoId: 'local', path: '/srv/repo', isMainWorktree: true }
    const list = [vmPrimary, other]
    expect(withoutHiddenVmWorktrees(list, readHiddenVmCheckouts())).toBe(list)

    hideVmCreateCheckout('c1', { repoId: 'vm-repo', path: '/srv/repo' })
    expect(withoutHiddenVmWorktrees(list, readHiddenVmCheckouts())).toEqual([other])
    releaseVmCreateCheckout('c1')
    expect(withoutHiddenVmWorktrees(list, readHiddenVmCheckouts())).toBe(list)
  })
})
