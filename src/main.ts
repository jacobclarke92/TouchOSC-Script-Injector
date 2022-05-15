import { ToscDoc, ToscNode, ToscGroupNode, ToscProperty } from './types.ts'
import { fileNameRegex, fileNameAndExtRegex } from './index.ts'
import { printBanner } from './banner.ts'
import { getToscFileContent, parseToscXML, writeDebugFiles, writeProjectFile } from './fileHandlers.ts'
import { exists } from 'https://deno.land/std@0.139.0/fs/mod.ts'
import { debounce } from 'https://deno.land/x/debounce@v0.0.7/mod.ts'

const stopwatch = [Date.now()]
export const stopwatchLast = () => stopwatch[stopwatch.length - 1]
export const stopwatchTick = () => {
  stopwatch.push(Date.now())
  return stopwatch.length < 2 ? 0 : stopwatch[stopwatch.length - 1] - stopwatch[stopwatch.length - 2]
}

let scriptInjectionLog: { [key: string]: number } = {}
const printResults = () => {
  console.log('📋 Results:')
  Object.keys(scriptInjectionLog).forEach((key) => console.log(`• ${key} - ${scriptInjectionLog[key]} injected`))
}

export async function processToscFile(filePath: string, scriptsDir: string, debugMode: boolean = false) {
  const fileName = filePath.match(fileNameRegex)?.[1]
  if (!fileName) throw '❌ Could not determine file name HALP'
  const fileDir = filePath.replace(fileNameAndExtRegex, '')

  console.log(`Reading "${filePath}"...`)
  const projectContent = await getToscFileContent(filePath)
  const fileSize = new Blob([projectContent]).size

  const parsedProject = parseToscXML(projectContent, fileSize)
  if (debugMode) writeDebugFiles(fileDir, fileName, parsedProject)

  await applyAllScriptFiles(parsedProject, scriptsDir)
  await writeProjectFile(parsedProject, fileDir, fileName, fileSize * 1.2)

  return parsedProject
}

const propertyMatch = (node: ToscNode | ToscGroupNode, key: string, value: string): boolean =>
  !!node.properties.property.find((property) => property.key === key && property.value === value)

const injectScriptRecursive = <NodeType extends ToscNode | ToscGroupNode>(
  node: NodeType,
  script: string,
  propertyKey: string,
  propertyValue: string
): NodeType => {
  let newNode: typeof node = { ...node }

  if ('children' in newNode && newNode.children.node.length > 0) {
    newNode.children = {
      node: newNode.children.node.map((child) => injectScriptRecursive(child, script, propertyKey, propertyValue)),
    }
  }

  if (propertyMatch(newNode, propertyKey, propertyValue)) {
    const existingScriptProperty = newNode.properties.property.find(({ key }) => key === 'script')
    const newProperty: ToscProperty = {
      '@type': 's',
      key: 'script',
      value: script,
    }
    newNode.properties = {
      property: existingScriptProperty
        ? newNode.properties.property.map((property) => (property.key === 'script' ? newProperty : property))
        : [...newNode.properties.property, newProperty],
    }
    const logKey = `${propertyKey}: ${propertyValue}`
    scriptInjectionLog[logKey] = (scriptInjectionLog[logKey] || 0) + 1
  }

  return newNode
}

const debounced_applyScriptFile: { [key: string]: Function } = {}
async function applyScriptFile(parsedProject: ToscDoc, scriptFilePath: string, prependScript?: string) {
  let luaScript = await Deno.readTextFile(scriptFilePath)
  if (prependScript) luaScript = prependScript + '\n\n' + luaScript

  // extract file name from path
  let fileName = scriptFilePath.match(fileNameRegex)?.[1]
  if (!fileName) return

  if (fileName === '_root') {
    const newProperty: ToscProperty = {
      '@type': 's',
      key: 'script',
      value: luaScript,
    }
    const rootProperties = parsedProject.lexml.node.properties.property
    const rootScriptPropertyExists = rootProperties.find(({ key }) => key === 'script')
    parsedProject.lexml.node.properties.property = rootScriptPropertyExists
      ? rootProperties.map((property) => (property.key === 'script' ? newProperty : property))
      : [...rootProperties, newProperty]
  } else {
    const key = fileName.match(/^tag_/) ? 'tag' : 'name'
    if (key === 'tag') fileName = fileName.replace(/^tag_/, '')

    const modifiedRootNode = injectScriptRecursive(parsedProject.lexml.node, luaScript, key, fileName)
    parsedProject.lexml.node = modifiedRootNode
  }
}

async function applyAllScriptFiles(parsedProject: ToscDoc, scriptsDir: string) {
  scriptInjectionLog = {}
  console.log('🔎 Scanning for files to inject...')
  const globalsScriptExists = await exists(scriptsDir + '_globals.lua')
  const globals = globalsScriptExists ? await Deno.readTextFile(scriptsDir + '_globals.lua') : undefined
  if (globals) console.log(`✓ Globals script found`)
  for await (const dirEntry of Deno.readDir(scriptsDir)) {
    if (!dirEntry.isFile) continue
    if (!dirEntry.name.match(/\.lua$/)) continue
    if (dirEntry.name.match(/^_globals/)) continue
    stopwatchTick()
    await applyScriptFile(parsedProject, scriptsDir + dirEntry.name, globals)
    console.log(`✓ Script file "${dirEntry.name}" applied (took ${stopwatchTick()} ms)`)
  }
  console.log('✅ Patching done!')
  printResults()
}

export async function startWatcher(
  parsedProject: ToscDoc,
  filePath: string,
  scriptsDir: string,
  debugMode: boolean = false
) {
  const fileName = filePath.match(fileNameRegex)?.[1]
  if (!fileName) throw '❌ Could not determine file name HALP'
  const fileDir = filePath.replace(fileNameAndExtRegex, '')

  console.log('👀 File watcher started')

  const globalsScriptExists = await exists(scriptsDir + '_globals.lua')
  const globals = globalsScriptExists ? await Deno.readTextFile(scriptsDir + '_globals.lua') : undefined

  const watcher = Deno.watchFs(scriptsDir)
  for await (const event of watcher) {
    if (event.kind !== 'modify') continue
    for (const checkPath of event.paths) {
      if (!checkPath.match(/\.lua$/)) {
        console.debug('Ignoring non-lua file:', checkPath)
        continue
      }
      if (!debugMode) printBanner(true)
      console.log(`👀 Watcher detected change in:\n${checkPath}\n`)
      if (checkPath.match(/_globals\.lua$/)) {
        console.log('♻️  Globals script changed, re-injecting all scripts...')
        await applyAllScriptFiles(parsedProject, scriptsDir)
        await writeProjectFile(parsedProject, fileDir, fileName)
      } else {
        // We do debouncing to avoid the script running twice -- once for save and once for vscode's formatting save
        if (!debounced_applyScriptFile[checkPath])
          debounced_applyScriptFile[checkPath] = debounce(async () => {
            scriptInjectionLog = {}
            await applyScriptFile(parsedProject, checkPath, globals)

            printResults()
            await writeProjectFile(parsedProject, fileDir, fileName)
          }, 200)

        await debounced_applyScriptFile[checkPath]()
      }
    }
  }
}
