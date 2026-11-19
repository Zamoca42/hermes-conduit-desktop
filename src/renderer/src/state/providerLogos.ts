/**
 * A model provider's logo, after the phone's ProviderLogo: Hermes sends a
 * provider's slug and name, never a logo, so the logos are bundled
 * (assets/provider-logos, from lobe-icons, MIT) and matched here by slug,
 * then alias, then a whole word of the slug or name. A provider with none
 * shows its initial. Nothing is fetched for them.
 */

/** Hermes' provider slugs, each to its logo. A provider listed under several slugs (a region, a plan, a sign-in) shares one. */
export const BY_SLUG: Record<string, string> = {
  nous: 'nous',
  openrouter: 'openrouter',
  fireworks: 'fireworks',
  novita: 'novita',
  lmstudio: 'lmstudio',
  anthropic: 'anthropic',
  'openai-codex': 'openai',
  'openai-api': 'openai',
  openai: 'openai',
  alibaba: 'qwen',
  'alibaba-cn': 'qwen',
  'alibaba-coding-plan': 'qwen',
  'alibaba-coding-plan-cn': 'qwen',
  'alibaba-token-plan': 'qwen',
  'alibaba-token-plan-cn': 'qwen',
  'qwen-oauth': 'qwen',
  xai: 'xai',
  'xai-oauth': 'xai',
  'xai-grok-oauth': 'xai',
  'tencent-tokenhub': 'tencent',
  'tencent-tokenplan': 'tencent',
  nvidia: 'nvidia',
  huggingface: 'huggingface',
  gemini: 'gemini',
  'google-gemini-cli': 'gemini',
  vertex: 'vertex',
  deepseek: 'deepseek',
  zai: 'zai',
  kimi: 'kimi',
  'kimi-cn': 'kimi',
  'kimi-coding': 'kimi',
  'kimi-coding-cn': 'kimi',
  'kimi-for-coding': 'kimi',
  'kimi-for-coding-highspeed': 'kimi',
  stepfun: 'stepfun',
  minimax: 'minimax',
  'minimax-cn': 'minimax',
  'minimax-oauth': 'minimax',
  'ollama-cloud': 'ollama',
  arcee: 'arcee',
  gmi: 'gmi',
  kilocode: 'kilocode',
  'opencode-zen': 'opencode',
  'opencode-go': 'opencode',
  bedrock: 'bedrock',
  'azure-foundry': 'azure',
  'ai-gateway': 'vercel',
  commandcode: 'commandcode',
  'commandcode-anthropic': 'commandcode',
  deepinfra: 'deepinfra',
  'meta-ai': 'meta',
  'nebius-token-factory': 'nebius',
  upstage: 'upstage',
  copilot: 'copilot',
  'copilot-acp': 'copilot'
}

/**
 * Words in a slug or name that name a provider, for one with no slug here: a
 * custom endpoint ("lab-vllm", "Together AI") or a plugin's. Whole words
 * only; the first found wins, so a host comes before the model makers it
 * serves ("Azure OpenAI" is Azure).
 */
export const BY_WORD: [string, string][] = [
  // Hosts and gateways.
  ['openrouter', 'openrouter'], ['azure', 'azure'], ['bedrock', 'bedrock'], ['vertex', 'vertex'],
  ['vercel', 'vercel'], ['ollama', 'ollama'], ['vllm', 'vllm'], ['lmstudio', 'lmstudio'],
  ['together', 'together'], ['groq', 'groq'], ['cerebras', 'cerebras'], ['sambanova', 'sambanova'],
  ['chutes', 'chutes'], ['siliconflow', 'siliconflow'], ['fireworks', 'fireworks'], ['deepinfra', 'deepinfra'],
  ['nvidia', 'nvidia'], ['huggingface', 'huggingface'], ['nebius', 'nebius'], ['novita', 'novita'],
  ['copilot', 'copilot'], ['opencode', 'opencode'], ['kilocode', 'kilocode'], ['nous', 'nous'],
  // Model makers.
  ['perplexity', 'perplexity'], ['cohere', 'cohere'], ['mistral', 'mistral'], ['deepseek', 'deepseek'],
  ['anthropic', 'anthropic'], ['claude', 'anthropic'], ['openai', 'openai'], ['chatgpt', 'openai'],
  ['codex', 'openai'], ['gemini', 'gemini'], ['qwen', 'qwen'], ['dashscope', 'qwen'], ['kimi', 'kimi'],
  ['moonshot', 'kimi'], ['minimax', 'minimax'], ['glm', 'zai'], ['zhipu', 'zai'], ['grok', 'xai'],
  ['xai', 'xai'], ['stepfun', 'stepfun']
]

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/** The logo for a provider, by its slug, then any alias, then a word of its slug or name; null when none is bundled. */
export function providerLogo(slug: string, name?: string, aliases: string[] = []): string | null {
  for (const spelling of [slug, ...aliases]) {
    let key = spelling.trim().toLowerCase()
    // A custom endpoint's saved spelling.
    if (key.startsWith('custom:')) key = key.slice('custom:'.length)
    if (BY_SLUG[key]) return BY_SLUG[key]!
  }
  const spellings = [slug, name ?? '', ...aliases]
  const all = new Set(spellings.flatMap(words))
  // "LM Studio" and "Hugging Face" are one word in a slug.
  const joined = new Set(spellings.map(s => words(s).join('')))
  return BY_WORD.find(([word]) => all.has(word) || joined.has(word))?.[1] ?? null
}

/** The initial a provider without a logo shows. */
export const providerInitial = (title: string) => ([...title].find(c => /[\p{L}\p{N}]/u.test(c)) ?? '?').toUpperCase()
