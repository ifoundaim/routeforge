#!/usr/bin/env node
import lighthouse from 'lighthouse'
import { launch } from 'chrome-launcher'

const APP = process.env.APP || 'http://localhost:5173/app/dashboard?present=1'
const PUB = process.env.PUB || 'http://localhost:8000/rel/1'

const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo']
const CATEGORY_SHORT = {
  performance: 'perf',
  accessibility: 'a11y',
  'best-practices': 'best',
  seo: 'seo',
}

async function runAudit(label, url, chrome) {
  const runner = await lighthouse(url, {
    port: chrome.port,
    logLevel: 'error',
    output: 'json',
    onlyCategories: CATEGORIES,
    disableStorageReset: true,
  })

  const segments = CATEGORIES.map(category => {
    const score = runner.lhr.categories[category]?.score ?? 0
    const value = Math.round(score * 100)
    const hint = value < 90 ? ' ⚠ below target' : ''
    return `${CATEGORY_SHORT[category]} ${value}${hint}`
  })

  console.log(`${label}: ${segments.join(' | ')}`)
}

async function main() {
  const targets = [
    { label: 'Present Mode', url: APP },
    { label: 'Public Release', url: PUB },
  ]

  const chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  })

  try {
    for (const target of targets) {
      await runAudit(target.label, target.url, chrome)
    }
  } catch (error) {
    console.error('Lighthouse audit failed:', error)
    process.exitCode = 1
  } finally {
    await chrome.kill()
  }
}

main()
