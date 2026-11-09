import type { SidebarFeedDomains } from '../../../shared/sidebar-list/sidebar-feed-domains'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'

/** A VM's primary checkout, registered on its host before the create that owns it finishes. */
export type HiddenVmCheckout = { repoId: string; path: string }

let hidden: ReadonlyMap<string, HiddenVmCheckout> = new Map()
const listeners = new Set<() => void>()

function publish(next: ReadonlyMap<string, HiddenVmCheckout>): void {
  hidden = next
  listeners.forEach((listener) => listener())
}

/**
 * Why: a VM create registers the VM's project before its checks run and before the checkout is
 * adopted or a worktree is made; the pending row stands for it until the create finishes.
 */
export function hideVmCreateCheckout(creationId: string, checkout: HiddenVmCheckout): void {
  publish(new Map(hidden).set(creationId, checkout))
}

/** The create finished, or its VM could not be cleaned up and the user must still see it. */
export function releaseVmCreateCheckout(creationId: string): void {
  if (!hidden.has(creationId)) {
    return
  }
  const next = new Map(hidden)
  next.delete(creationId)
  publish(next)
}

export function subscribeHiddenVmCheckouts(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function readHiddenVmCheckouts(): ReadonlyMap<string, HiddenVmCheckout> {
  return hidden
}

export function isHiddenVmCheckout(
  checkouts: Iterable<HiddenVmCheckout>,
  row: { repoId: string; path: string; isMainWorktree?: boolean }
): boolean {
  if (row.isMainWorktree === false) {
    return false
  }
  const path = normalizeRuntimePathForComparison(row.path)
  for (const checkout of checkouts) {
    if (
      checkout.repoId === row.repoId &&
      normalizeRuntimePathForComparison(checkout.path) === path
    ) {
      return true
    }
  }
  return false
}

function withoutHidden<K, V extends { repoId: string; path: string; isMainWorktree?: boolean }>(
  rows: ReadonlyMap<K, V>,
  checkouts: readonly HiddenVmCheckout[]
): ReadonlyMap<K, V> {
  let kept: Map<K, V> | null = null
  for (const [key, row] of rows) {
    if (isHiddenVmCheckout(checkouts, row)) {
      kept ??= new Map(rows)
      kept.delete(key)
    }
  }
  return kept ?? rows
}

/** The window's sidebar list without the primary checkouts of VMs whose creates are in progress. */
export function withoutHiddenVmWorktrees<
  W extends { repoId: string; path: string; isMainWorktree?: boolean }
>(worktrees: W[], checkouts: ReadonlyMap<string, HiddenVmCheckout>): W[] {
  if (checkouts.size === 0) {
    return worktrees
  }
  const kept = worktrees.filter((worktree) => !isHiddenVmCheckout(checkouts.values(), worktree))
  return kept.length === worktrees.length ? worktrees : kept
}

/** Main's rows without the primary checkouts of VMs whose creates are still in progress. */
export function withoutHiddenVmCheckouts(
  domains: SidebarFeedDomains,
  checkouts: ReadonlyMap<string, HiddenVmCheckout>
): SidebarFeedDomains {
  if (checkouts.size === 0) {
    return domains
  }
  const list = [...checkouts.values()]
  const workspaces = withoutHidden(domains.workspaces, list)
  const pairedServerRows = withoutHidden(domains.pairedServerRows, list)
  return workspaces === domains.workspaces && pairedServerRows === domains.pairedServerRows
    ? domains
    : { ...domains, workspaces, pairedServerRows }
}
