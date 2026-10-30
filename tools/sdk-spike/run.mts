// npm run spike -- <check> [<check> ...] | all
// Results land in tools/sdk-spike/results/<check>.json, raw streams in
// tools/fake-claude/fixtures/<fixture>.jsonl.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checks } from './checks.mts'
import { claudeExe, resultsDir, scrub, tag } from './lib.mts'

const wanted = process.argv.slice(2)
const names = wanted.length === 0 || wanted.includes('all') ? Object.keys(checks) : wanted
const unknown = names.filter((n) => !checks[n])
if (unknown.length) {
  console.error(`Unknown check(s): ${unknown.join(', ')}. Known: ${Object.keys(checks).join(', ')}`)
  process.exit(1)
}

mkdirSync(resultsDir, { recursive: true })
console.log(`claude: ${claudeExe}`)
let failed = 0
for (const name of names) {
  console.log(`\n=== ${name}`)
  const started = Date.now()
  let out: unknown
  try {
    out = { ok: true, ...(await checks[name]()) }
  } catch (e) {
    failed++
    out = { ok: false, error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) }
    console.error(`!!! ${name} failed:`, e)
  }
  const file = join(resultsDir, `${name}${tag}.json`)
  writeFileSync(file, scrub(JSON.stringify(out, null, 2)))
  console.log(`=== ${name} done in ${((Date.now() - started) / 1000).toFixed(1)} s → ${file}`)
}
process.exit(failed ? 1 : 0)
