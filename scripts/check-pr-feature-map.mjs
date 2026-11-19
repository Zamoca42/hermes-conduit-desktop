#!/usr/bin/env node
/**
 * Fails a pull request whose description doesn't name the feature map entry
 * it touches.
 *
 * hermes-conduit's docs/FEATURE_MAP.md lists each feature with its siblings,
 * this app included: each entry's Desktop app line says whether the desktop
 * has it. A desktop PR names the entries it changes in its Feature map
 * section, so the phone's next change to that feature finds this one, and
 * flips the entry's Desktop app line (a hermes-conduit PR) when it catches a
 * feature up. "No mapped feature" and why is for a change with no siblings on
 * the phone (packaging, CI, a desktop-only fix).
 *
 * CI passes the description in PR_BODY. The entry names are read from
 * hermes-conduit main; if GitHub can't be reached the check warns and only
 * looks for an answer.
 *
 *   PR_BODY="$(cat body.md)" node scripts/check-pr-feature-map.mjs
 */
import { pathToFileURL } from 'node:url'

export const MAP_URL = 'https://raw.githubusercontent.com/kaishi00/hermes-conduit/main/docs/FEATURE_MAP.md'

const HOW =
  'Fill in the Feature map section of the PR description: the hermes-conduit docs/FEATURE_MAP.md ' +
  'entries this PR changes, by their names (and the hermes-conduit PR that updates their Desktop ' +
  'app line, when it changes), or "No mapped feature: <why>".'

/** The entry names in a feature map: its `## ` headings outside fenced blocks. */
export function entryNames(map) {
  const names = []
  let fenced = false
  for (const line of map.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    else if (!fenced && line.startsWith('## ')) names.push(line.slice(3).trim())
  }
  return names
}

/** The text of the description's Feature map section, comments left out, or null. */
export function section(body) {
  const text = (body ?? '').replace(/\r\n/g, '\n')
  const start = /^##\s+Feature map\s*$/im.exec(text)
  if (!start) return null
  const rest = text.slice(start.index + start[0].length)
  const next = /^##\s/m.exec(rest)
  return (next ? rest.slice(0, next.index) : rest).replace(/<!--[\s\S]*?-->/g, '').trim()
}

/** What's wrong with the description's Feature map section, or null. Without
 *  the map's entry names (GitHub out of reach), any answer passes. */
export function problem(body, names) {
  const found = section(body)
  if (found === null) return `The PR description has no "## Feature map" section. ${HOW}`
  if (!found) return `The Feature map section is empty. ${HOW}`
  const none = /^[\s>*_-]*no mapped feature\b[\s:.,;()*_-]*(.*)/is.exec(found)
  if (none) return none[1].trim() ? null : 'The Feature map section says No mapped feature, so it says why.'
  if (!names) return null
  const lower = found.toLowerCase()
  if (names.some(name => lower.includes(name.toLowerCase()))) return null
  return `The Feature map section names no entry of hermes-conduit's docs/FEATURE_MAP.md. ${HOW}`
}

async function main() {
  let names = null
  try {
    const response = await fetch(MAP_URL, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    names = entryNames(await response.text())
  } catch (error) {
    console.log(`::warning::Couldn't read the feature map from hermes-conduit (${error.message}); entry names weren't checked.`)
  }
  const found = problem(process.env.PR_BODY ?? '', names)
  if (found) {
    console.log(`::error::${found}`)
    process.exit(1)
  }
  console.log('The Feature map section names its entries.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main()
