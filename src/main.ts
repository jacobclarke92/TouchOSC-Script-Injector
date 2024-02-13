import { ToscDoc, ToscNode, ToscGroupNode, ToscProperty } from './types.ts'
import { fileNameRegex, fileNameAndExtRegex } from './index.ts'
import { printBanner } from './banner.ts'
import {
  getToscFileContent,
  parseToscXML,
  writeDebugFiles,
  writeProjectFile,
  findReplaceScriptQuick,
} from './fileHandlers.ts'
import { exists } from 'https://deno.land/std@0.215.0/fs/mod.ts'
import { debounce } from 'https://deno.land/x/debounce@v0.0.7/mod.ts'

const stopwatch = [Date.now()]
export const stopwatchLast = () => stopwatch[stopwatch.length - 1]
export const stopwatchTick = () => {
  stopwatch.push(Date.now())
  return stopwatch.length < 2 ? 0 : stopwatch[stopwatch.length - 1] - stopwatch[stopwatch.length - 2]
}

let scriptInjectionLog: { [key: string]: number } = {}
let lastInjectionLog: typeof scriptInjectionLog = {}
const printResults = () => {
  console.log('📋 Results:')
  Object.keys(scriptInjectionLog)
    .sort()
    .forEach((key) => {
      const value = scriptInjectionLog[key]
      console.log(`${value === 0 ? '!' : '•'} ${key} - ${value} injected`)
    })
}

const getInjectionLogKey = (scriptFileName: string) => {
  if (scriptFileName === '_root') return scriptFileName
  const key = scriptFileName.match(/^tag_/) ? 'tag' : 'name'
  const value = key === 'tag' ? scriptFileName.replace(/^tag_/, '') : scriptFileName
  return `${key}: ${value}`
}

/**
 * Reads TOSC file, process scripts, writes new TOSC file returns the document tree for reference
 */
export async function processToscFile({
  projectFilePath,
  scriptsDir,
  debugMode = false,
}: {
  projectFilePath: string
  scriptsDir: string
  debugMode?: boolean
}) {
  const projectFileName = projectFilePath.match(fileNameRegex)?.[1]
  if (!projectFileName) throw '❌ Could not determine file name HALP'
  const projectFileDir = projectFilePath.replace(fileNameAndExtRegex, '')

  console.log(`Reading "${projectFilePath}"...`)
  const projectContent = await getToscFileContent(projectFilePath)
  const fileSize = new Blob([projectContent]).size

  const parsedProject = parseToscXML({ xmlString: projectContent, fileSize })
  if (debugMode) writeDebugFiles({ parsedProject, projectFileDir, projectFileName })

  await applyAllScriptFiles({ parsedProject, scriptsDir, projectFileDir, projectFileName, debugMode })
  await writeProjectFile({ parsedProject, projectFileDir, projectFileName, fileSize: fileSize * 1.25 })

  return parsedProject
}

const propertyMatch = (node: ToscNode | ToscGroupNode, key: string, value: string): boolean =>
  !!node.properties.property.find((property) => property.key === key && property.value === value)

const injectScriptRecursive = <NodeType extends ToscNode | ToscGroupNode>({
  node,
  script,
  propertyKey,
  propertyValue,
}: {
  node: NodeType
  script: string
  propertyKey: string
  propertyValue: string
}): NodeType => {
  let newNode: typeof node = { ...node }

  if ('children' in newNode && newNode.children.node.length > 0) {
    newNode.children = {
      node: newNode.children.node.map((child) =>
        injectScriptRecursive({ node: child, script, propertyKey, propertyValue })
      ),
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

    const logKey = getInjectionLogKey(propertyKey === 'tag' ? `tag_${propertyValue}` : propertyValue)
    scriptInjectionLog[logKey] = (scriptInjectionLog[logKey] || 0) + 1
  }

  return newNode
}

let debounced_applyScriptFile: { [key: string]: Function } = {}
let scriptCache: { [key: string]: string } = {}
async function applyScriptFile({
  parsedProject,
  scriptFilePath,
  prependScript,
  projectFileDir,
  projectFileName,
  debugMode = false,
}: {
  parsedProject: ToscDoc
  scriptFilePath: string
  prependScript?: string
  projectFileDir: string
  projectFileName: string
  debugMode?: boolean
}) {
  const scriptDeleted = !(await exists(scriptFilePath))
  let luaScript = ''
  if (scriptDeleted) {
    console.log('🗑 File deleted')
  } else {
    luaScript = await Deno.readTextFile(scriptFilePath)
    if (prependScript) luaScript = prependScript + '\n\n' + luaScript
  }

  // extract file name from path
  const scriptFileName = scriptFilePath.match(fileNameRegex)?.[1]
  if (!scriptFileName) return

  if (Object.keys(scriptCache).includes(scriptFileName) && !!scriptCache[scriptFileName]) {
    if (lastInjectionLog[getInjectionLogKey(scriptFileName)] === 0) {
      console.log(`💨 ${scriptFileName} was previously not matched to any node, skipping update`)
      return false
    }

    if (debugMode) console.log('🧠 Found old script in cache, attempting a quick replace...')
    const oldScript = scriptCache[scriptFileName]

    const quickReplaceResults = await findReplaceScriptQuick({
      oldScript,
      newScript: luaScript,
      projectFileDir,
      projectFileName,
    })

    if (quickReplaceResults === false) {
      console.log('❓ Quick replace failed, proceeding to full rebuild...')
    } else if (quickReplaceResults >= 1) {
      console.log(`✅ Quick replace updated ${quickReplaceResults} instances`)
      if (!scriptDeleted) scriptCache[scriptFileName] = luaScript
      return false
    }
  }

  if (scriptFileName === '_root') {
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

    scriptInjectionLog['_root'] = 1
  } else {
    const propertyKey = scriptFileName.match(/^tag_/) ? 'tag' : 'name'
    const propertyValue = propertyKey === 'tag' ? scriptFileName.replace(/^tag_/, '') : scriptFileName

    scriptInjectionLog[getInjectionLogKey(scriptFileName)] = 0

    const modifiedRootNode = injectScriptRecursive({
      node: parsedProject.lexml.node,
      script: luaScript,
      propertyKey,
      propertyValue,
    })
    parsedProject.lexml.node = modifiedRootNode
  }

  if (!scriptDeleted) scriptCache[scriptFileName] = luaScript
  return true
}

async function applyAllScriptFiles({
  parsedProject,
  scriptsDir,
  projectFileDir,
  projectFileName,
  debugMode = false,
}: {
  parsedProject: ToscDoc
  scriptsDir: string
  projectFileDir: string
  projectFileName: string
  debugMode?: boolean
}) {
  let requiresRebuild = false
  lastInjectionLog = { ...scriptInjectionLog }
  scriptInjectionLog = {}
  console.log('🔎 Scanning for files to inject...')
  let foundFiles = 0
  const globalsScriptExists = await exists(scriptsDir + '_globals.lua')
  const globals = globalsScriptExists ? await Deno.readTextFile(scriptsDir + '_globals.lua') : undefined
  if (globals) {
    foundFiles++
    if (debugMode) console.log(`✓ Globals script found`)
  }
  for await (const dirEntry of Deno.readDir(scriptsDir)) {
    if (!dirEntry.isFile) continue
    if (!dirEntry.name.match(/\.lua$/)) continue
    if (dirEntry.name.match(/^_globals/)) continue
    foundFiles++
    stopwatchTick()
    const scriptRequiresRebuild = await applyScriptFile({
      parsedProject,
      scriptFilePath: scriptsDir + dirEntry.name,
      prependScript: globals,
      projectFileDir,
      projectFileName,
      debugMode,
    })
    if (debugMode) console.log(`✓ Script file "${dirEntry.name}" applied (took ${stopwatchTick()} ms)`)
    if (scriptRequiresRebuild) requiresRebuild = true
  }
  console.log(`✅ ${foundFiles} scripts found and patched!`)
  if (requiresRebuild) printResults()

  lastInjectionLog = { ...scriptInjectionLog }
  return requiresRebuild
}

let scriptsWatcher: Deno.FsWatcher | undefined
let toscFileWatcher: Deno.FsWatcher | undefined

export async function startScriptsWatcher({
  parsedProject,
  projectFilePath,
  scriptsDir,
  debugMode = false,
}: {
  parsedProject: ToscDoc
  projectFilePath: string
  scriptsDir: string
  debugMode?: boolean
}) {
  const projectFileName = projectFilePath.match(fileNameRegex)?.[1]
  if (!projectFileName) throw '❌ Could not determine file name HALP'
  const projectFileDir = projectFilePath.replace(fileNameAndExtRegex, '')

  console.log('👀 Scripts watcher started')

  const globalsScriptExists = await exists(scriptsDir + '_globals.lua')
  const globals = globalsScriptExists ? await Deno.readTextFile(scriptsDir + '_globals.lua') : undefined

  if (scriptsWatcher) throw 'Scripts watcher already exists'
  scriptsWatcher = Deno.watchFs(scriptsDir)
  for await (const event of scriptsWatcher) {
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
        const requiresRebuild = await applyAllScriptFiles({
          parsedProject,
          scriptsDir,
          projectFileDir,
          projectFileName,
          debugMode,
        })
        if (requiresRebuild) await writeProjectFile({ parsedProject, projectFileDir, projectFileName })
      } else {
        // We do debouncing to avoid the script running twice -- once for save and once for vscode's formatting save
        if (!debounced_applyScriptFile[checkPath])
          debounced_applyScriptFile[checkPath] = debounce(async () => {
            scriptInjectionLog = {}
            const requiresRebuild = await applyScriptFile({
              parsedProject,
              scriptFilePath: checkPath,
              prependScript: globals,
              projectFileDir,
              projectFileName,
              debugMode,
            })
            if (requiresRebuild) {
              printResults()
              await writeProjectFile({ parsedProject, projectFileDir, projectFileName })
            }
          }, 200)

        await debounced_applyScriptFile[checkPath]()
      }
    }
  }
}

export async function startToscFileWatcher({
  projectFilePath,
  callback,
}: {
  projectFilePath: string
  callback: () => void
}) {
  console.log('👀 TOSC file watcher started')
  if (toscFileWatcher) throw 'Tosc file watcher already exists'
  toscFileWatcher = Deno.watchFs(projectFilePath)
  for await (const event of toscFileWatcher) {
    if (event.kind === 'modify') await callback()
  }
}

export async function cancelWatchers() {
  console.log('😆 Cancelling watchers...')
  scriptInjectionLog = {}
  scriptCache = {}
  debounced_applyScriptFile = {}
  await Promise.all([scriptsWatcher?.return?.(), toscFileWatcher?.return?.()])
  scriptsWatcher = undefined
  toscFileWatcher = undefined
}
