import { ToscDoc, ToscNode, ToscGroupNode, ToscProperty } from './types.ts'
import { stopwatchTick } from './main.ts'
import { parse as parseXml, stringify as encodeXml } from 'https://deno.land/x/xml@2.0.4/mod.ts'
import { XmlEntities } from 'https://deno.land/x/html_entities@v1.0/mod.js'
import { inflate } from 'https://deno.land/x/compress@v0.4.5/zlib/inflate.ts'

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
  try {
    const rawContent = await Deno.readFile(filePath)
    const inflatedContent = inflate(rawContent)
    return new TextDecoder('utf-8').decode(inflatedContent)
  } catch (err) {
    throw '❌ Failed to decode file'
  }
}

export function parseToscXML(xmlString: string): ToscDoc {
  stopwatchTick()
  try {
    const json = parseXml(xmlString) as unknown as ToscDoc
    console.log(`✅ XML successfully parsed (took ${stopwatchTick()} ms)`)
    return json
  } catch (e) {
    throw '❌ Could not parse XML file'
  }
}

export async function writeDebugFiles(fileDir: string, fileName: string, parsedProject: ToscDoc) {
  stopwatchTick()
  await Deno.writeTextFile(fileDir + fileName + '_DEBUG.json', JSON.stringify(parsedProject, null, 2))
  console.log(`✅ Wrote to JSON file for debugging (took ${stopwatchTick()} ms)`)

  stopwatchTick()
  await Deno.writeTextFile(
    fileDir + fileName + '_DEBUG.tosc',
    encodeXml(parsedProject as any, { replacer: cDataRestorer })
  )
  console.log(`✅ Wrote to XML file for debugging (took ${stopwatchTick()} ms)`)
}

type StringifierOptions = Exclude<Parameters<typeof encodeXml>[1], undefined>
const cDataRestorer: StringifierOptions['replacer'] = ({ key, value, tag }) =>
  ['key', 'value'].includes(tag) && key === '#text' && typeof value === 'string' && !!value
    ? `<![CDATA[${XmlEntities.decode(value)}]]>`
    : value

export async function writeProjectFile(parsedProject: ToscDoc, fileDir: string, fileName: string) {
  console.log('📝 Re-encoding to XML and saving file...')
  stopwatchTick()
  const xmlString = encodeXml(parsedProject as any, { indentSize: 0, replacer: cDataRestorer })
  const newFileName = fileDir + fileName + '_INJECTED.tosc'
  await Deno.writeTextFile(newFileName, xmlString)
  console.log(`✅ Project file written (took ${stopwatchTick()} ms)`)
  console.log(newFileName)
}
