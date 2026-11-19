import { providerInitial, providerLogo } from '../state/providerLogos'

// Every bundled logo, by name: `name.svg` keeps its brand colours, `name.mono.svg` takes the text colour.
const FILES = import.meta.glob('../assets/provider-logos/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const LOGOS = new Map<string, { url: string; mono: boolean }>()
for (const [path, url] of Object.entries(FILES)) {
  const file = path
    .split('/')
    .pop()!
    .replace(/\.svg$/, '')
  const mono = file.endsWith('.mono')
  LOGOS.set(mono ? file.slice(0, -'.mono'.length) : file, { url, mono })
}

/** A provider's logo beside its name, or its initial in a circle when none is bundled. Hidden from screen readers: the name is beside it. */
export function ProviderLogo({ slug, title, aliases, size = 18 }: { slug: string; title: string; aliases?: string[]; size?: number }) {
  const name = providerLogo(slug, title, aliases)
  const logo = name ? LOGOS.get(name) : undefined
  const box = { width: size, height: size }
  if (!logo)
    return (
      <span className="provider-logo initial" style={{ ...box, fontSize: size * 0.55 }} aria-hidden="true">
        {providerInitial(title)}
      </span>
    )
  if (logo.mono)
    return <span className="provider-logo mono" style={{ ...box, WebkitMaskImage: `url("${logo.url}")`, maskImage: `url("${logo.url}")` }} aria-hidden="true" />
  return <img className="provider-logo" src={logo.url} style={box} alt="" aria-hidden="true" />
}
