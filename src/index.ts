import { printBanner } from './banner.ts'
import { processToscFile, startWatcher } from './main.ts'
import Ask from 'https://deno.land/x/ask@1.0.6/mod.ts'

const debugMode = !!(Deno.args || []).find((arg) => arg === '--debug')
const filePathArg = (Deno.args || []).find((str) => str.match(/\.tosc$/))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const fileNameAndExtRegex = /[^\\/:"*?<>|]+\.\w+$/
export const fileNameRegex = /([^\\/:"*?<>|]+)(?:\.\w+$)/
const runtimePath = new URL('', import.meta.url).pathname
const runtimeDir = runtimePath.replace(fileNameAndExtRegex, '')

const ask = new Ask()
const askForFilePath = async () =>
  (
    await ask.input({ name: 'filePath', message: `Drag a .tosc file into this window, then press enter\n` })
  )?.filePath?.trim()

const ensureFilePath = async () => {
  let answer = await askForFilePath()
  while (!answer) answer = await askForFilePath()
  const isAbsolutePath = answer.match(/^(\/)|(\w{1}\:)/)
  if (!isAbsolutePath) answer = runtimeDir + answer
  return answer
}

if (!debugMode) printBanner(true)

let filePath: string = filePathArg ? filePathArg.replace(/^\.\//, '') : await ensureFilePath()
let scriptsDir: string = filePath.replace(fileNameAndExtRegex, '') + 'scripts/'

async function letsGo() {
  const parsedProject = await (async () => {
    try {
      return await processToscFile(filePath, scriptsDir, debugMode)
    } catch (e) {
      console.log(e)
      return false
    }
  })()

  if (!parsedProject) {
    console.log('❌ An issue occurred, will restart shortly...')
    await sleep(2500)
    if (!debugMode) printBanner(true)
    filePath = await ensureFilePath()
    scriptsDir = filePath.replace(fileNameAndExtRegex, '') + 'scripts/'
    await letsGo()
    return
  }

  console.log('\n🎉🎉🎉🎉🎉\n')

  await startWatcher(parsedProject, filePath, scriptsDir)
}

letsGo()
