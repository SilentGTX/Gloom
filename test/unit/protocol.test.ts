import { describe, expect, it } from 'vitest'
import { fileFor } from '../../src/main/protocol'
import { isRendererUrl } from '../../src/main/window'

describe('app://gloom serves the renderer’s folder and nothing else', () => {
  const root = 'C:\\Gloom\\resources\\app.asar\\out\\renderer'

  it('finds the files the page asks for', () => {
    expect(fileFor(root, '/index.html')).toBe(`${root}\\index.html`)
    expect(fileFor(root, '/assets/App-DT8_1BRZ.js')).toBe(`${root}\\assets\\App-DT8_1BRZ.js`)
    expect(fileFor(root, '/assets/a%20b.png')).toBe(`${root}\\assets\\a b.png`)
  })

  it('refuses paths that leave it', () => {
    expect(fileFor(root, '/../main/index.js')).toBeNull()
    expect(fileFor(root, '/..%5C..%5Cpackage.json')).toBeNull()
    expect(fileFor(root, '/%2e%2e/%2e%2e/secret')).toBeNull()
    expect(fileFor(root, '/assets/..\\..\\..\\secret')).toBeNull()
    expect(fileFor(root, '/C:%5CWindows%5Cwin.ini')).toBeNull()
    expect(fileFor(root, '/')).toBeNull()
    expect(fileFor(root, '/%E0%A4%A')).toBeNull()
  })
})

describe('the page Gloom trusts', () => {
  it('is app://gloom/index.html, with or without a query', () => {
    expect(isRendererUrl('app://gloom/index.html')).toBe(true)
    expect(isRendererUrl('app://gloom/index.html?handover')).toBe(true)
  })

  it('is no other page on the scheme, and no other scheme', () => {
    expect(isRendererUrl('app://gloom/blank.html')).toBe(false)
    expect(isRendererUrl('app://evil/index.html')).toBe(false)
    expect(isRendererUrl('other://gloom/index.html')).toBe(false)
    expect(isRendererUrl('file:///C:/Gloom/resources/app.asar/out/renderer/index.html')).toBe(false)
    expect(isRendererUrl('https://gloom/index.html')).toBe(false)
    expect(isRendererUrl('not a url')).toBe(false)
  })
})
