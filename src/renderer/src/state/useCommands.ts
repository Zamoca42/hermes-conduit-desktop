import { useEffect, useState } from 'react'
import { gateway } from '../gateway'
import { builtInCommands, normalizeCatalog, type SlashCommand } from './slash'

/** The slash commands a chat under `profile` takes: Hermes' catalog, or the built-in few when it can't be read. */
export function useCommands(profile: string | undefined, connected: boolean): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>(() => builtInCommands())
  useEffect(() => {
    if (!connected) return
    let live = true
    gateway
      .rpc('commands.catalog', profile ? { profile } : {})
      .then(raw => live && setCommands(normalizeCatalog(raw)))
      .catch(() => live && setCommands(builtInCommands()))
    return () => {
      live = false
    }
  }, [profile, connected])
  return commands
}
