/**
 * How one path should open in the IDE center column.
 *
 * Text and markdown stay editable; binary kinds load through `readBytes` and
 * render in the media viewer.
 */

/** The center column's presentation for one open file. */
export type IdeViewKind = 'text' | 'markdown' | 'html' | 'image' | 'pdf' | 'video' | 'audio'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg'])
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v'])
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])

/**
 * The suffix of one path, lowercased and without the dot.
 * @param path - the file path.
 * @returns the suffix, or an empty string when there is none.
 */
function suffix(path: string): string {
  const base = path.replace(/^.*[/\\]/, '')
  const dot = base.lastIndexOf('.')
  if (dot < 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/**
 * The center-column kind for one file path.
 * @param path - the file's absolute path.
 * @returns the view kind the workspace should use.
 */
export function ideViewKind(path: string): IdeViewKind {
  const ext = suffix(path)
  if (ext === 'md' || ext === 'mdx') return 'markdown'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'pdf') return 'pdf'
  if (IMAGE.has(ext)) return 'image'
  if (VIDEO.has(ext)) return 'video'
  if (AUDIO.has(ext)) return 'audio'
  return 'text'
}

/**
 * Whether the IDE should load one path through the text `read` API.
 * @param kind - the file's view kind.
 * @returns true for editable or previewable text sources.
 */
export function ideViewUsesTextRead(kind: IdeViewKind): boolean {
  return kind === 'text' || kind === 'markdown' || kind === 'html'
}

/**
 * The MIME type to wrap one binary read for display.
 * @param path - the file's absolute path.
 * @returns a MIME string suitable for a blob URL.
 */
export function ideMimeType(path: string): string {
  const ext = suffix(path)
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'bmp': return 'image/bmp'
    case 'ico': return 'image/vnd.microsoft.icon'
    case 'svg': return 'image/svg+xml'
    case 'pdf': return 'application/pdf'
    case 'mp4': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'mov':
    case 'm4v': return 'video/quicktime'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'ogg': return 'audio/ogg'
    case 'm4a': return 'audio/mp4'
    case 'flac': return 'audio/flac'
    case 'aac': return 'audio/aac'
    default: return 'application/octet-stream'
  }
}