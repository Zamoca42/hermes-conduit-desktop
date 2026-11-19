import { smallestPicture } from './roomLooks'

/** An image URL loaded as an image, or null. */
function load(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

/**
 * A square JPEG of the picture at `url`, center-cropped on black, small
 * enough to send as a room look (base64), or null for one that can't be
 * drawn. A moving picture gives its first frame.
 */
export async function lookPicture(url: string): Promise<string | null> {
  const image = await load(url)
  const width = image?.naturalWidth || image?.width || 0
  const height = image?.naturalHeight || image?.height || 0
  if (!image || !width || !height) return null
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  let drawnAt = 0
  try {
    return smallestPicture((edge, quality) => {
      if (drawnAt !== edge) {
        canvas.width = edge
        canvas.height = edge
        const scale = edge / Math.min(width, height)
        context.fillStyle = '#000'
        context.fillRect(0, 0, edge, edge)
        context.drawImage(image, (edge - width * scale) / 2, (edge - height * scale) / 2, width * scale, height * scale)
        drawnAt = edge
      }
      const url = canvas.toDataURL('image/jpeg', quality)
      return url.startsWith('data:image/jpeg;base64,') ? url.slice('data:image/jpeg;base64,'.length) : null
    })
  } catch {
    return null
  }
}

/** A CSS color as `#RRGGBB`, or null for one the browser can't read. */
export function hexColor(css: string): string | null {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  context.fillStyle = '#000001'
  context.fillStyle = css
  const value = String(context.fillStyle)
  if (/^#[0-9a-f]{6}$/i.test(value)) return value === '#000001' && css.trim().toLowerCase() !== '#000001' ? null : value.toUpperCase()
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  return rgb ? `#${rgb.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase() : null
}
