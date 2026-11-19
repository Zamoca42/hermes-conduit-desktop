/**
 * Whether Hermes refused a chat request because the chat's live runtime is gone: a socket's park
 * outlived `dashboard.ws_orphan_reap_grace_s` (20 s by default), or an idle or LRU eviction. Hermes
 * answers `4001 "session not found"` (`tui_gateway/session_registry.py::_sess_nowait`), and the
 * session authority the same code with `data.reason` `not_found`; another reason is a refusal of
 * its own. The stored id still resumes the chat, as the phone does (FEATURE_MAP, Reconnecting to Hermes).
 */
export function isRuntimeGone(error: unknown): boolean {
  const e = error as { code?: unknown; reason?: unknown; message?: unknown } | null
  if (e?.code === 4001 && (e.reason === undefined || e.reason === null || e.reason === 'not_found')) return true
  return typeof e?.message === 'string' && /session not found/i.test(e.message)
}
