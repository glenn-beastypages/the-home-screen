import { PageFold } from './PageFold'
import type { CSSProperties } from 'react'
import { CATEGORY_GLYPHS } from '../data/categoryGlyphs'
import { categoryByKind } from '../data/categories'
import { PAGE_ICON_PATH } from './pageIcon'

/* The plain BEASTY background is the home screen's own wallpaper, so a tile
   cut from it reads as a hole in the screen. Those get a deeper tint. */
const PLAIN = '/wallpapers/cat-beasty-thumb.webp'

/**
 * A BEASTY category as a tile: a squircle of the category page's own background
 * with its line drawing on top, a glass sheen and a hairline edge. Fills
 * whatever box it is put in, like SlotIcon.
 */
export function CategoryIcon({ kind, thumb }: { kind: string; thumb: string | null }) {
  /* A category added without a drawing used to leave a blank tile ("Some are
     randomly blank", Glenn, 2026-11-16). Its first letter stands in until it has
     one; tools/audit-category-glyphs.ts fails the build check meanwhile. */
  const g = CATEGORY_GLYPHS[kind] ?? { paths: [], text: (categoryByKind(kind)?.heading ?? kind).charAt(0).toUpperCase() }
  const style: CSSProperties = {}
  if (thumb) style.backgroundImage = thumb === PLAIN ? `linear-gradient(rgba(12, 12, 16, 0.5), rgba(12, 12, 16, 0.5)), url(${thumb})` : `url(${thumb})`
  return (
    <span className="cat-icon" aria-hidden="true" style={style}>
      <svg className="cat-icon-edge" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={PAGE_ICON_PATH} vectorEffect="non-scaling-stroke" />
        <PageFold />
      </svg>
      <svg className="cat-icon-glyph" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {g.paths.map((d) => (
          <path key={d} d={d} />
        ))}
        {g.dots?.map(([cx, cy, r]) => (
          <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={r} fill="#fff" stroke="none" />
        ))}
        {g.text && (
          <text x="12" y={g.paths.length ? 16 : 17} textAnchor="middle" fontSize={g.paths.length ? 5.5 : 14} fontWeight="700" fontFamily="Arial, sans-serif" fill="#fff" stroke="none">
            {g.text}
          </text>
        )}
      </svg>
    </span>
  )
}

/** The small square of a page's background that stands for it. */
export const thumbFor = (page: { kind: string; wall?: string; yellow?: true }): string =>
  page.wall
    ? page.wall.replace(/\.webp$/, '-thumb.webp')
    : page.yellow
      ? '/wallpapers/cat-yellow-thumb.webp'
      : PLAIN
