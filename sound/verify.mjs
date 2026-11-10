import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Run with: node sound/verify.mjs
// Checks the downloaded candidate inventory, not the application's audio behavior.
const base = path.dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(fs.readFileSync(path.join(base, 'catalog.json'), 'utf8'))
const inventory = fs.readFileSync(path.resolve(base, catalog.inventory), 'utf8')
const sources = new Map(catalog.sources.map((source) => [source.id, source]))
const groups = new Map(catalog.groups.map((group) => [group.id, group]))
assert.equal(groups.size, catalog.groups.length, 'Duplicate group IDs')
assert.equal(new Set(catalog.actions.map((action) => action.id)).size, catalog.actions.length, 'Duplicate action IDs')

const clips = catalog.groups.flatMap((group) => group.candidates)
assert.equal(new Set(clips.map((clip) => clip.id)).size, clips.length, 'Duplicate candidate IDs')
assert.equal(new Set(clips.map((clip) => clip.file)).size, clips.length, 'Duplicate file paths')
for (const group of catalog.groups) {
  assert.equal(group.candidates.length, 3, `${group.id}: expected 3 candidates`)
  assert.ok(group.selected === null || group.candidates.some((clip) => clip.id === group.selected), `${group.id}: invalid selection`)
  for (const clip of group.candidates) {
    const source = sources.get(clip.source)
    assert.ok(source, `${clip.id}: unknown source`)
    assert.equal(source.license, 'CC0-1.0')
    const absolute = path.resolve(base, clip.file)
    assert.ok(absolute.startsWith(base + path.sep), `${clip.id}: invalid path`)
    const buffer = fs.readFileSync(absolute)
    assert.equal(buffer.length, clip.bytes, `${clip.id}: size mismatch`)
    assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), clip.sha256, `${clip.id}: hash mismatch`)
    assert.ok(clip.durationSeconds > 0 && clip.sampleRate > 0 && clip.channels > 0, `${clip.id}: invalid audio metadata`)
    const magic = buffer.toString('ascii', 0, 4)
    const mp3 = magic.startsWith('ID3') || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
    assert.ok(magic === 'OggS' || (magic === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') || mp3, `${clip.id}: not audio`)
    assert.equal(clip.modified, false)
    if (source.licenseFile) assert.ok(fs.existsSync(path.join(base, source.licenseFile)))
  }
}

const actionRows = inventory.split(/\r?\n/).filter((line) => /\| [TWBMS]\d{2} \|/.test(line))
assert.equal(actionRows.length, catalog.actions.length, 'Action inventory count mismatch')
for (const action of catalog.actions) {
  const row = actionRows.find((line) => line.includes(`| ${action.id} |`))
  assert.ok(row, `${action.id}: missing inventory row`)
  assert.equal(row.split('|')[1].trim(), action.action, `${action.id}: action label mismatch`)
  assert.ok(action.group === null || groups.has(action.group), `${action.id}: unknown group`)
  for (const group of Object.values(action.alternatives ?? {})) assert.ok(groups.has(group), `${action.id}: unknown alternative`)
  if (!action.group) assert.ok(row.includes('無音'), `${action.id}: silent action must remain silent`)
  else assert.ok(row.includes(`../../sound/README.md#${action.group}`) || action.alternatives, `${action.id}: missing group link`)
}

const readme = fs.readFileSync(path.join(base, 'README.md'), 'utf8')
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8')
for (const group of catalog.groups) {
  assert.ok(readme.includes(`id="${group.id}"`), `${group.id}: missing README anchor`)
  for (const clip of group.candidates) assert.ok(html.includes(`src="${clip.file}"`), `${clip.id}: missing preview`)
  const section = html.match(new RegExp(`<section id="${group.id}"[\\s\\S]*?</section>`))?.[0]
  assert.ok(section, `${group.id}: missing preview section`)
  if (group.selected === null) {
    assert.ok(section.includes('アプリでは無音') && !section.includes('（採用）'), `${group.id}: silent preview mismatch`)
  } else {
    assert.ok(readme.includes(`| ${group.selected}（採用） |`), `${group.id}: README selection mismatch`)
    assert.ok(section.includes(`候補 ${group.selected.slice(-1)}（採用）`), `${group.id}: preview selection mismatch`)
    assert.equal((section.match(/（採用）/g) ?? []).length, 1, `${group.id}: multiple preview selections`)
  }
}
for (const doc of ['README.md', 'index.html', 'licenses/sources.md']) {
  const body = fs.readFileSync(path.join(base, doc), 'utf8')
  const targets = doc.endsWith('.html')
    ? [...body.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)].map((match) => match[1])
    : [...body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((match) => match[1])
  for (const target of targets.filter((target) => !/^https?:/.test(target))) {
    assert.ok(fs.existsSync(path.resolve(base, path.dirname(doc), decodeURI(target))), `${doc}: broken link ${target}`)
  }
}
const audioFiles = fs.readdirSync(path.join(base, 'candidates'), { recursive: true }).filter((file) => /\.(wav|ogg|mp3)$/.test(file))
assert.equal(audioFiles.length, clips.length, 'Unexpected or missing audio files')
console.log(`OK: ${catalog.actions.length} actions, ${catalog.groups.length} groups, ${clips.length} audio files, ${catalog.actions.filter((a) => !a.group).length} silent rows; hashes, sources and local links verified.`)
