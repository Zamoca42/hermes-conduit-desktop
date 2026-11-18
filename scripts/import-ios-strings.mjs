#!/usr/bin/env node
/**
 * Copies the iPhone app's translations into src/shared/strings.json wherever
 * the desktop uses the same English text, so both apps say the same thing.
 * Keys the desktop has and the iPhone app doesn't keep their own
 * translations; the iPhone app's win where both have one.
 *
 *   node scripts/import-ios-strings.mjs ../hermes-conduit
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ios = process.argv[2]
if (!ios) {
  console.error('Usage: node scripts/import-ios-strings.mjs <path to hermes-conduit>')
  process.exit(1)
}

const LANGUAGES = ['de', 'es', 'fr', 'id', 'it', 'ja', 'ko', 'pl', 'pt-BR', 'ru', 'tr', 'zh-Hans', 'zh-Hant']
const catalogs = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name.startsWith('.') || name === 'build' ? [] : catalogs(path)
    return name.endsWith('.xcstrings') && !name.startsWith('InfoPlist') ? [path] : []
  })

const theirs = {}
for (const file of catalogs(join(ios, 'Conduit'))) {
  for (const [key, entry] of Object.entries(JSON.parse(readFileSync(file, 'utf8')).strings ?? {})) {
    for (const language of LANGUAGES) {
      const value = entry.localizations?.[language]?.stringUnit?.value
      if (value && !(theirs[key] ??= {})[language]) theirs[key][language] = value
    }
  }
}

const path = new URL('../src/shared/strings.json', import.meta.url)
const strings = JSON.parse(readFileSync(path, 'utf8'))
let copied = 0
for (const key of Object.keys(strings)) {
  for (const language of LANGUAGES) {
    const value = theirs[key]?.[language]
    if (value && strings[key][language] !== value) {
      strings[key][language] = value
      copied++
    }
  }
}
const sorted = Object.fromEntries(Object.keys(strings).sort().map(key => [key, strings[key]]))
writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
console.log(`Copied ${copied} translations from the iPhone app.`)
