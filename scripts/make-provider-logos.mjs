#!/usr/bin/env node
// Copies the provider logos from lobe-icons' SVGs into the app, the same
// set the phone bundles (hermes-conduit scripts/make-provider-logos.py):
//
//   curl -sO https://registry.npmjs.org/@lobehub/icons-static-svg/-/icons-static-svg-1.102.0.tgz
//   tar xzf icons-static-svg-1.102.0.tgz
//   node scripts/make-provider-logos.mjs package/icons
//
// A single-colour logo is drawn in the text colour; a "-color" one keeps its
// brand colours. A logo added here also needs its Hermes slugs in
// src/renderer/src/state/providerLogos.ts.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LOGOS = {
  anthropic: 'anthropic',
  arcee: 'arcee-color',
  bedrock: 'bedrock-color',
  azure: 'azureai-color',
  cerebras: 'cerebras-color',
  chutes: 'chutes',
  cohere: 'cohere',
  commandcode: 'commandcode',
  copilot: 'githubcopilot',
  deepinfra: 'deepinfra-color',
  deepseek: 'deepseek-color',
  fireworks: 'fireworks-color',
  gemini: 'gemini-color',
  gmi: 'gmicloud',
  groq: 'groq',
  huggingface: 'huggingface-color',
  kilocode: 'kilocode',
  kimi: 'kimi',
  lmstudio: 'lmstudio',
  meta: 'meta-color',
  minimax: 'minimax-color',
  mistral: 'mistral-color',
  nebius: 'nebius',
  nous: 'nousresearch',
  novita: 'novita-color',
  nvidia: 'nvidia-color',
  ollama: 'ollama',
  openai: 'openai',
  opencode: 'opencode',
  openrouter: 'openrouter',
  perplexity: 'perplexity-color',
  qwen: 'qwen-color',
  sambanova: 'sambanova-color',
  siliconflow: 'siliconcloud-color',
  stepfun: 'stepfun-color',
  tencent: 'tencent-color',
  together: 'together-color',
  upstage: 'upstage-color',
  vercel: 'vercel',
  vertex: 'vertexai-color',
  vllm: 'vllm-color',
  xai: 'xai',
  zai: 'zai'
}

const source = process.argv[2]
if (!source) throw new Error('Usage: node scripts/make-provider-logos.mjs <lobe-icons icons folder>')
const out = 'src/renderer/src/assets/provider-logos'
// Read every logo first, so a wrong folder leaves the set as it was.
const files = Object.entries(LOGOS).map(([name, file]) => {
  const svg = readFileSync(join(source, `${file}.svg`), 'utf8')
    .replace(/<title>.*?<\/title>/s, '')
    .replace('height="1em"', 'height="24"')
    .replace('width="1em"', 'width="24"')
  return [`${name}${file.endsWith('-color') ? '' : '.mono'}.svg`, svg]
})
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const [name, svg] of files) writeFileSync(join(out, name), svg)
console.log(`Wrote ${files.length} logos to ${out}.`)
