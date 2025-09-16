import { expect, test } from '@playwright/test'

const UI_BASE_URL = process.env.UI_BASE_URL
  || process.env.PLAYWRIGHT_UI_BASE_URL
  || process.env.PLAYWRIGHT_BASE_URL
  || 'http://localhost:5173'

const API_BASE_URL = process.env.API_BASE_URL
  || process.env.PLAYWRIGHT_API_BASE_URL
  || 'http://localhost:8000'

const DEFAULT_TARGET_URL = 'https://example.com/'

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8)
}

test('happy path redirect increments hit counter', async ({ context, page, request }) => {
  const timestamp = Date.now()
  const projectName = `e2e-project-${timestamp}`
  const owner = `owner-${randomSuffix()}`
  const releaseVersion = `1.0.${timestamp % 1000}`
  const routeSlug = `route-${timestamp}`
  const targetUrl = process.env.E2E_TARGET_URL || DEFAULT_TARGET_URL

  const upgradeResponse = await request.post(`${API_BASE_URL}/dev/upgrade`, { data: { pro: true } })
  expect(upgradeResponse.ok()).toBeTruthy()

  await page.goto(UI_BASE_URL, { waitUntil: 'load' })

  await page.getByPlaceholder('Name').fill(projectName)
  await page.getByPlaceholder('Owner').fill(owner)
  await page.getByPlaceholder('Description').fill('Playwright E2E project')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByText(projectName)).toBeVisible()
  await expect(page.getByText(`owner: ${owner}`)).toBeVisible()

  await page.getByPlaceholder('Version (e.g. 1.2.3)').fill(releaseVersion)
  await page.getByPlaceholder('Artifact URL').fill(targetUrl)
  await page.getByPlaceholder('Notes (optional)').fill('Playwright E2E release')
  await page.getByRole('button', { name: 'Create release' }).click()
  await expect(page.getByText(`v${releaseVersion}`)).toBeVisible()

  await page.getByPlaceholder('Slug (unique)').fill(routeSlug)
  await page.getByPlaceholder('Target URL').fill(targetUrl)
  await page.getByRole('button', { name: 'Create route' }).click()

  const routeRow = page.getByRole('row', { name: new RegExp(routeSlug) })
  await expect(routeRow).toBeVisible()
  const detailTrigger = routeRow.getByRole('button', { name: 'Details' })
  await detailTrigger.click()

  const routeDetailCard = page.locator('.card', { hasText: `Route detail: ${routeSlug}` })
  await expect(routeDetailCard).toBeVisible()
  await expect(routeDetailCard.getByText('Loading…')).toHaveCount(0)

  const refreshButton = routeDetailCard.getByRole('button', { name: 'Refresh' })
  await refreshButton.click()

  const readHitCount = async () => {
    const emptyState = await routeDetailCard.getByText('No hits yet').count()
    if (emptyState > 0) {
      return 0
    }
    return await routeDetailCard.locator('ul li').count()
  }

  const initialHits = await readHitCount()

  const openRedirectButton = routeDetailCard.getByRole('button', { name: 'Open' })
  const [redirectPage] = await Promise.all([
    context.waitForEvent('page'),
    openRedirectButton.click(),
  ])

  await redirectPage.waitForLoadState('domcontentloaded')
  await redirectPage.waitForURL(targetUrl, { waitUntil: 'load' })
  await redirectPage.close()

  let updatedHits = initialHits
  for (let attempt = 0; attempt < 6; attempt++) {
    await refreshButton.click()
    await page.waitForTimeout(750)
    updatedHits = await readHitCount()
    if (updatedHits > initialHits) {
      break
    }
  }

  expect(updatedHits).toBeGreaterThan(initialHits)
})
