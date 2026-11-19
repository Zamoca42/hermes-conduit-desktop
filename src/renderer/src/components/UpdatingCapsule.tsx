import { useEffect, useState } from 'react'
import { t } from '@shared/i18n'

/**
 * The phone's Updating… capsule (issue 2706): it floats at the bottom of the
 * Chats list, so no row moves under the pointer, and takes no clicks. It
 * shows after 0.4 s, so a quick read never blinks it, and fades 0.3 s after.
 */
export function UpdatingCapsule({ shown }: { shown: boolean }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!shown) return setVisible(false)
    const timer = setTimeout(() => setVisible(true), 400)
    return () => clearTimeout(timer)
  }, [shown])
  return (
    <div className={`updating-capsule${visible ? ' visible' : ''}`} role="status" aria-live="polite" aria-hidden={!visible}>
      {visible ? t('Updating…') : null}
    </div>
  )
}
