import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

// Build portable, self-contained profiles from the reviewed family dictionary.
// There is no runtime inheritance and no cross-model numeric-ID guessing.
export function buildTeltonikaProfileDefinitions(catalog) {
  if (catalog.manufacturer !== 'Teltonika' || catalog.family !== 'FMX003') throw new Error('Unsupported catalog namespace.')
  return Object.fromEntries(Object.entries(catalog.profiles).map(([model, profile]) => {
    if (!catalog.scope.models.includes(model)) throw new Error('Model is outside the reviewed catalog scope: ' + model)
    const attributeMap = Object.fromEntries(Object.entries(catalog.attributeMap).map(([key, mapping]) => {
      const field = { ...mapping }
      if (field.sourceRepresentation === 'raw-io') field.sourceReference = field.sourceReference.replace('FMM003_', model + '_')
      const override = profile.attributeOverrides?.[key]
      return [key, override ? { ...field, ...override } : field]
    }))
    for (const [key, mapping] of Object.entries(profile.attributeOverrides || {})) {
      if (mapping === null) delete attributeMap[key]
      else if (!attributeMap[key]) attributeMap[key] = { ...mapping }
    }
    return [profile.file, { id: profile.id, name: profile.name, schemaVersion: catalog.schemaVersion, attributeMap }]
  }))
}

async function main() {
  const catalog = JSON.parse(await readFile(new URL('../device-field-catalog/teltonika/fmx003-mappings.json', import.meta.url), 'utf8'))
  const definitions = buildTeltonikaProfileDefinitions(catalog)
  const check = process.argv.includes('--check')
  for (const [file, definition] of Object.entries(definitions)) {
    if (!/^teltonika-fmm(?:003|00a)\.json$/.test(file)) throw new Error('Unexpected generated profile filename: ' + file)
    const url = new URL('../device-profiles/' + file, import.meta.url)
    if (check) {
      const existing = JSON.parse(await readFile(url, 'utf8'))
      if (JSON.stringify(existing) !== JSON.stringify(definition)) throw new Error(file + ' differs from the reviewed family dictionary.')
    } else await writeFile(url, JSON.stringify(definition, null, 2) + '\n')
    console.log((check ? 'Verified ' : 'Updated ') + file + ': ' + Object.keys(definition.attributeMap).length + ' mappings')
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
