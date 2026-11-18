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
      const localization = entry.localizations?.[language]
      // A plural takes its "other" form, the one that reads with a number.
      const value = localization?.stringUnit?.value ?? localization?.variations?.plural?.other?.stringUnit?.value
      if (value && !(theirs[key] ??= {})[language]) theirs[key][language] = value
    }
  }
}

// The iPhone app's %@ and %lld are the desktop's {name}: a key matches with its
// placeholders in the same places, and each one's translation takes the names.
const IOS_PLACEHOLDER = /%(?:(\d+)\$)?(?:@|lld|ld|d)/g
const shapes = {}
for (const key of Object.keys(theirs)) {
  if (IOS_PLACEHOLDER.test(key)) shapes[key.replace(IOS_PLACEHOLDER, '\u0000')] ??= key
  IOS_PLACEHOLDER.lastIndex = 0
}
function placeheld(key) {
  const names = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1])
  if (!names.length) return null
  const source = shapes[key.replace(/\{\w+\}/g, '\u0000')]
  if (!source) return null
  const translated = {}
  for (const [language, value] of Object.entries(theirs[source])) {
    let index = 0
    let ok = true
    const text = value.replace(IOS_PLACEHOLDER, (_, position) => {
      const name = names[position ? Number(position) - 1 : index++]
      if (!name) ok = false
      return `{${name}}`
    })
    if (ok) translated[language] = text
  }
  return translated
}

const path = new URL('../src/shared/strings.json', import.meta.url)
const strings = JSON.parse(readFileSync(path, 'utf8'))
let copied = 0
const fills = {}
for (const key of Object.keys(strings)) {
  for (const language of LANGUAGES) {
    // A match by placeholders only fills a gap: the same words can mean something else there.
    const exact = theirs[key]?.[language]
    const value = exact ?? (strings[key][language] ? undefined : (fills[key] ??= placeheld(key) ?? {})[language])
    if (value && strings[key][language] !== value) {
      strings[key][language] = value
      copied++
    }
  }
}
const sorted = Object.fromEntries(Object.keys(strings).sort().map(key => [key, strings[key]]))
writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n')
console.log(`Copied ${copied} translations from the iPhone app.`)
