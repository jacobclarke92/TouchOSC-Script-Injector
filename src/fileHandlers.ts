import { ToscDoc } from './types.ts'
import { stopwatchTick, stopwatchLast } from './main.ts'
import { parse as parseXml, stringify as encodeXml } from 'https://deno.land/x/xml@2.0.4/mod.ts'
import { XmlEntities } from 'https://deno.land/x/html_entities@v1.0/mod.js'
import { inflate } from 'https://deno.land/x/compress@v0.4.5/zlib/inflate.ts'
import ProgressBar from 'https://deno.land/x/progress@v1.2.5/mod.ts'

export async function getToscFileContent(filePath: string) {
  const content = await Deno.readTextFile(filePath)
  if (content.match(/^<\?xml/)) {
    console.log(`✅ Project file is XML-based`)
    return content
  }

  console.log(`Project file is not XML based, attempting to convert...`)
  stopwatchTick()
  const decodedFile = await decodeToscFile(filePath)
  console.log(`✅ Decoded file in ${stopwatchTick()}ms`)
  return decodedFile
}

export async function decodeToscFile(filePath: string) {
  const rawContent = await (async () => {
    try {
      return Deno.readFile(filePath)
    } catch (error) {
      throw '❌ Failed to read file'
    }
  })()
  const inflatedContent = (() => {
    try {
      return inflate(rawContent)
    } catch (error) {
      throw '❌ Failed to inflate file'
    }
  })()
  const decodedContent = (() => {
    try {
      return new TextDecoder('utf-8').decode(inflatedContent)
    } catch (error) {
      throw '❌ Failed to decode inflated content'
    }
  })()
  return decodedContent
}

export function parseToscXML({ xmlString, fileSize }: { xmlString: string; fileSize?: number }): ToscDoc {
  console.log('⏱ Parsing XML...')
  stopwatchTick()
  const total = fileSize || new Blob([xmlString]).size
  const progress = new ProgressBar({ total, display: ':percent [:bar] :time' })
  try {
    const json = parseXml(xmlString, { progress: (bytes) => progress.render(bytes) }) as unknown as ToscDoc
    progress.render(total)
    console.log(`✅ XML successfully parsed (took ${stopwatchTick()} ms)`)
    return json
  } catch (e) {
    throw '❌ Could not parse XML file'
  }
}

export async function writeDebugFiles({
  parsedProject,
  projectFileDir,
  projectFileName,
}: {
  projectFileDir: string
  projectFileName: string
  parsedProject: ToscDoc
}) {
  stopwatchTick()
  await Deno.writeTextFile(projectFileDir + projectFileName + '_DEBUG.json', JSON.stringify(parsedProject, null, 2))
  console.log(`✅ Wrote to JSON file for debugging (took ${stopwatchTick()} ms)`)

  stopwatchTick()
  await Deno.writeTextFile(
    projectFileDir + projectFileName + '_DEBUG.tosc',
    encodeXml(parsedProject as any, { replacer: cDataRestorer })
  )
  console.log(`✅ Wrote to XML file for debugging (took ${stopwatchTick()} ms)`)
}

type StringifierOptions = Exclude<Parameters<typeof encodeXml>[1], undefined>
const cDataRestorer: StringifierOptions['replacer'] = ({ key, value, tag }) =>
  ['key', 'value'].includes(tag) && key === '#text' && typeof value === 'string' && !!value
    ? `<![CDATA[${XmlEntities.decode(value)}]]>`
    : value

export let lastEncodeTime = 0
export async function writeProjectFile({
  parsedProject,
  projectFileDir,
  projectFileName,
  fileSize,
}: {
  parsedProject: ToscDoc
  projectFileDir: string
  projectFileName: string
  fileSize?: number
}) {
  console.log('📝 Re-encoding to XML...')
  const progress = new ProgressBar({
    total: fileSize || lastEncodeTime,
    display: fileSize
      ? ':percent [:bar] :time / ?'
      : `≈ :percent [:bar] :time / ${(lastEncodeTime / 1000).toFixed(1)}s`,
  })
  stopwatchTick()
  const initialTime = stopwatchLast()
  const xmlString = encodeXml(parsedProject as any, {
    indentSize: 0,
    replacer: cDataRestorer,
    progress: (bytes) => (fileSize || lastEncodeTime) && progress.render(fileSize ? bytes : Date.now() - initialTime),
  })
  progress.render(fileSize || lastEncodeTime)
  progress.end()
  if (fileSize) lastEncodeTime = Date.now() - initialTime
  console.log(`✅ XML encoding done (took ${stopwatchTick()} ms)`)
  console.log('⏱ Writing file...')
  const newFileName = projectFileDir + projectFileName + '_INJECTED.tosc'
  await Deno.writeTextFile(newFileName, xmlString)
  console.log(`✅ Project file written (took ${stopwatchTick()} ms)`)
  console.log(newFileName)
}

export async function findReplaceScriptQuick({
  oldScript,
  newScript,
  projectFileDir,
  projectFileName,
}: {
  oldScript: string
  newScript: string
  projectFileDir: string
  projectFileName: string
}) {
  const projectFile = projectFileDir + projectFileName + '_INJECTED.tosc'
  const content = await (async () => {
    try {
      return await Deno.readTextFile(projectFile)
    } catch (e) {
      return false
    }
  })()
  if (!content) return false

  // the xml formatting process removes indentation within the script
  // so we need to do the same in order for the find-replace to work
  const formattedOldScript = oldScript.replace(/^[^\n]\s+/gm, '').trim()

  let search = ''
  if (content.indexOf(oldScript) >= 0) search = oldScript
  else if (content.indexOf(formattedOldScript) >= 0) search = formattedOldScript
  else return false

  let replacements = 0
  const newContent = content.replaceAll(search, () => {
    replacements++
    return newScript
  })
  try {
    await Deno.writeTextFile(projectFile, newContent)
  } catch (error) {
    return false
  }
  return replacements
}
