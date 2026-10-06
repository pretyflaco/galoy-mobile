// Fault-tolerant group loading (F-M6P-8). marmot-ts 0.5.1's `groups.loadAll()` is
// `Promise.all` over every stored group: ONE unreadable state rejects the whole call, so a
// client can't start at all. That happens for real: ts-mls rc.11+ cannot deserialize state
// written by rc.10. Load each group separately; report the failures instead of dying.
// RN-safe (no Node imports).

/**
 * @returns {Promise<{ groups: any[], failed: { id: string, error: Error }[] }>}
 *   `id` is the MLS group id (hex, the store key)
 */
export async function loadGroups(client, { onError } = {}) {
  const keys = await client.groups.store.keys()
  const groups = []
  const failed = []
  for (const id of keys) {
    try {
      groups.push(await client.groups.get(id))
    } catch (error) {
      failed.push({ id, error })
      onError?.(id, error)
    }
  }
  return { groups, failed }
}
