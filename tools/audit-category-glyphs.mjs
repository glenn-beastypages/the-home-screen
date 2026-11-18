/*
  Every BEASTY category has its line drawing.

    node tools/audit-category-glyphs.mjs      (also run by tools/audit-all.mjs)

  Glenn, 2026-11-16 and 2026-11-18: "Some are randomly blank". They were not
  random: 29 categories added after the first set had no entry in
  CATEGORY_GLYPHS, so their tiles on BEASTY • Pages, More pages and in Search
  showed only the background. This fails the moment a category is added
  without a drawing, and checks each drawing is well formed and the same size
  and density as the set (docs/CATEGORIES.md, "Every category has a drawing").
*/
import assert from 'node:assert/strict'
import { tsImport } from 'tsx/esm/api'

const { CATEGORY_GLYPHS, PAGES_TILES } = await tsImport('../src/data/categoryGlyphs.ts', import.meta.url)
const { BEASTY_CATEGORIES } = await tsImport('../src/data/categories.ts', import.meta.url)

let n = 0
const ok = (name, value) => {
  assert.ok(value, name)
  n++
}

const missing = BEASTY_CATEGORIES.filter((c) => !CATEGORY_GLYPHS[c.kind]).map((c) => `${c.kind} (${c.heading})`)
ok(`every category has a drawing; missing: ${missing.join(', ') || 'none'}`, missing.length === 0)
const tiles = PAGES_TILES.filter((k) => !CATEGORY_GLYPHS[k])
ok(`every BEASTY • Pages tile has a drawing; missing: ${tiles.join(', ') || 'none'}`, tiles.length === 0)

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/
for (const c of BEASTY_CATEGORIES) {
  const g = CATEGORY_GLYPHS[c.kind]
  ok(`${c.kind} draws something`, g.paths.length > 0 || (g.dots?.length ?? 0) > 0 || g.text)
  for (const d of g.paths) ok(`${c.kind} path is plain SVG path data: ${d}`, PATH.test(d) && /^[Mm]/.test(d.trim()))
  for (const [cx, cy, r] of g.dots ?? []) ok(`${c.kind} dot sits on the 24-unit grid`, cx >= 0 && cx <= 24 && cy >= 0 && cy <= 24 && r > 0 && r <= 6)
  const numbers = g.paths.join(' ').match(/-?\d*\.?\d+/g)?.map(Number) ?? []
  ok(`${c.kind} stays near the 24-unit grid`, numbers.every((v) => v >= -25 && v <= 25))
  // Same weight as the set: a drawing is a few strokes, not a picture (the
  // original 52 run from 2 to 11 paths; dots-only Pit's is the exception).
  ok(`${c.kind} keeps to the set's density (${g.paths.length} paths)`, g.paths.length <= 11)
}
console.log(`PASS: ${BEASTY_CATEGORIES.length} categories, all drawn (${n} checks).`)
