// @ts-check
'use strict'

/**
 * Playwright end-to-end tests for deploy/index.html.
 *
 * External dependencies are fully mocked:
 *   - Google Identity Services (GIS) script blocked via page.route() and
 *     replaced with a synchronous mock injected via addInitScript.
 *   - GitHub raw file requests intercepted via page.route().
 *   - Apps Script REST API requests intercepted via page.route().
 */

const { test, expect } = require('@playwright/test')
const path = require('path')

const PAGE_URL = `file://${path.resolve(__dirname, '..', 'index.html')}`

// ── GIS OAuth mock ────────────────────────────────────────────────────────────

/**
 * Injected into the browser before any page scripts run.
 * Replaces google.accounts.oauth2 with a synchronous stub.
 *
 * Modes (controlled via window.__authMode):
 *   'success' – immediately calls callback with a fake access_token
 *   'failure' – immediately calls callback with an error
 */
function injectGisMock() {
  window.__authMode = 'success'
  window.__clientIdUsed = null

  window.google = {
    accounts: {
      oauth2: {
        initTokenClient(config) {
          window.__clientIdUsed = config.client_id
          return {
            requestAccessToken() {
              if (window.__authMode === 'success') {
                config.callback({ access_token: 'mock-access-token-xyz' })
              } else {
                config.callback({ error: 'access_denied' })
              }
            },
          }
        },
      },
    },
  }
}

// ── Route helpers ─────────────────────────────────────────────────────────────

/** Sets up routes for a complete, successful deploy flow. */
async function mockSuccessfulDeploy(page) {
  // GitHub raw source files
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: '// mock script source\nfunction main() {}',
    })
  })

  // Apps Script REST API — project creation and content upload
  await page.route('https://script.googleapis.com/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (method === 'POST' && url.endsWith('/projects')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scriptId: 'mock-project-id-abc' }),
      })
    } else if (method === 'PUT' && url.includes('/content')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      })
    } else {
      await route.continue()
    }
  })
}

/** Fills the Client ID input and clicks Sign in. */
async function signIn(
  page,
  clientId = 'test-client.apps.googleusercontent.com'
) {
  await page.fill('#client-id-input', clientId)
  await page.locator('#btn-signin').click()
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('deploy index.html', () => {
  test.beforeEach(async ({ page }) => {
    // Block the real GIS script so it cannot overwrite our mock
    await page.route('https://accounts.google.com/**', (route) => route.abort())

    // Inject the synchronous GIS mock before page scripts run
    await page.addInitScript(injectGisMock)

    await page.goto(PAGE_URL)
  })

  // ── Page structure ──────────────────────────────────────────────────────────

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle('Deploy Google Apps Scripts')
  })

  test('renders heading and subtitle', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Deploy Google Apps Scripts')
    await expect(page.locator('header p')).toContainText('Deploy a script')
  })

  test('renders four numbered step badges', async ({ page }) => {
    const badges = page.locator('.step-badge')
    await expect(badges).toHaveCount(4)
    await expect(badges.nth(0)).toHaveText('1')
    await expect(badges.nth(1)).toHaveText('2')
    await expect(badges.nth(2)).toHaveText('3')
    await expect(badges.nth(3)).toHaveText('4')
  })

  test('renders OAuth Client ID input with correct placeholder', async ({
    page,
  }) => {
    await expect(page.locator('#client-id-input')).toBeVisible()
    await expect(page.locator('#client-id-input')).toHaveAttribute(
      'placeholder',
      '123456789-abc.apps.googleusercontent.com'
    )
  })

  test('renders sign-in button', async ({ page }) => {
    await expect(page.locator('#btn-signin')).toBeVisible()
    await expect(page.locator('#btn-signin')).toContainText(
      'Sign in with Google'
    )
  })

  test('renders setup instructions expandable section', async ({ page }) => {
    await expect(page.locator('details summary')).toContainText(
      'How do I get a Client ID'
    )
  })

  // ── renderScriptList ────────────────────────────────────────────────────────

  test('script list is populated on page load', async ({ page }) => {
    const checkboxes = page.locator('#script-list input[type="checkbox"]')
    await expect(checkboxes).toHaveCount(2)
  })

  test('script list shows Gmail to Drive By Labels option', async ({
    page,
  }) => {
    await expect(
      page.locator('#script-list input[value="gmail-to-drive-by-labels"]')
    ).toBeVisible()
    await expect(page.locator('#script-list')).toContainText(
      'Gmail to Drive By Labels'
    )
  })

  test('script list shows Calendar to Sheets option', async ({ page }) => {
    await expect(
      page.locator('#script-list input[value="calendar-to-sheets"]')
    ).toBeVisible()
    await expect(page.locator('#script-list')).toContainText(
      'Calendar to Sheets'
    )
  })

  test('project title input has default value', async ({ page }) => {
    await expect(page.locator('#project-title-input')).toHaveValue(
      'My Google Apps Script'
    )
  })

  // ── setDeployEnabled ────────────────────────────────────────────────────────

  test('deploy button is disabled on load', async ({ page }) => {
    await expect(page.locator('#btn-deploy')).toBeDisabled()
  })

  test('deploy button remains disabled after sign-in without script selection', async ({
    page,
  }) => {
    await signIn(page)
    await expect(page.locator('#btn-deploy')).toBeDisabled()
  })

  test('deploy button remains disabled after sign-in without a project title', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.fill('#project-title-input', '')
    await expect(page.locator('#btn-deploy')).toBeDisabled()
  })

  test('deploy button enables after sign-in with script and title', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    // Default title already filled — button should enable
    await expect(page.locator('#btn-deploy')).toBeEnabled()
  })

  test('deploy button re-disables when title is cleared', async ({ page }) => {
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
    await page.fill('#project-title-input', '')
    await expect(page.locator('#btn-deploy')).toBeDisabled()
  })

  // ── handleSignIn ────────────────────────────────────────────────────────────

  test('handleSignIn with empty client ID shows error', async ({ page }) => {
    await page.fill('#client-id-input', '')
    await page.locator('#btn-signin').click()
    await expect(page.locator('.status-error')).toContainText(
      'enter your OAuth'
    )
  })

  test('handleSignIn passes the provided client ID to GIS', async ({
    page,
  }) => {
    await signIn(page, 'my-custom-client.apps.googleusercontent.com')
    const clientId = await page.evaluate(() => window.__clientIdUsed)
    expect(clientId).toBe('my-custom-client.apps.googleusercontent.com')
  })

  test('successful sign-in shows signed-in indicator in auth-status span', async ({
    page,
  }) => {
    await signIn(page)
    await expect(page.locator('#auth-status')).toContainText('Signed in')
  })

  test('successful sign-in updates sign-in button text', async ({ page }) => {
    await signIn(page)
    await expect(page.locator('#btn-signin')).toContainText('Signed in')
  })

  test('handleSignIn with OAuth error shows error status', async ({ page }) => {
    await page.evaluate(() => {
      window.__authMode = 'failure'
    })
    await signIn(page)
    await expect(page.locator('.status-error')).toContainText('Sign-in failed')
    await expect(page.locator('.status-error')).toContainText('access_denied')
  })

  // ── handleDeploy – guard paths ──────────────────────────────────────────────

  test('handleDeploy shows error when called without an access token', async ({
    page,
  }) => {
    // Select a script and force-enable the button, but do NOT sign in
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.evaluate(() => {
      document.getElementById('btn-deploy').disabled = false
    })
    await page.evaluate(() => window.handleDeploy())
    await expect(page.locator('.status-error')).toContainText('sign in first')
  })

  // ── handleDeploy – success flow ─────────────────────────────────────────────

  test('handleDeploy success shows link to the new Apps Script project', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()

    await expect(page.locator('.status-ok')).toBeVisible()
    await expect(page.locator('.result-link')).toHaveAttribute(
      'href',
      'https://script.google.com/d/mock-project-id-abc/edit'
    )
    await expect(page.locator('.result-link')).toHaveAttribute(
      'target',
      '_blank'
    )
  })

  test('handleDeploy success shows the project title in the message', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.fill('#project-title-input', 'My Archive Script')
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-ok')).toContainText('My Archive Script')
  })

  test('deploy button resets to "Deploy to my account" after successful deploy', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')
    await expect(page.locator('#btn-deploy')).toHaveText('Deploy to my account')
  })

  // ── fetchScriptFiles – URL construction ─────────────────────────────────────

  test('fetchScriptFiles fetches code.gs and config.gs from the correct GitHub URL', async ({
    page,
  }) => {
    const capturedUrls = []
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      capturedUrls.push(route.request().url())
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      if (route.request().method() === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'id' }),
        })
      } else if (url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(
      capturedUrls.some((u) => u.includes('gmail-to-drive-by-labels/code.gs'))
    ).toBe(true)
    expect(
      capturedUrls.some((u) => u.includes('gmail-to-drive-by-labels/config.gs'))
    ).toBe(true)
  })

  test('handleDeploy includes appsscript manifest in content upload', async ({
    page,
  }) => {
    let uploadBody = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        uploadBody = JSON.parse(route.request().postData())
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(uploadBody).not.toBeNull()
    const manifest = uploadBody.files.find((f) => f.name === 'appsscript')
    expect(manifest).toBeDefined()
    expect(manifest.type).toBe('JSON')
    const parsed = JSON.parse(manifest.source)
    expect(parsed).toHaveProperty('runtimeVersion', 'V8')
    expect(parsed).not.toHaveProperty('executionApi')
    expect(parsed).not.toHaveProperty('oauthScopes')
  })

  test('handleDeploy includes setup.gs with hourly trigger in content upload', async ({
    page,
  }) => {
    let uploadBody = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        uploadBody = JSON.parse(route.request().postData())
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(uploadBody).not.toBeNull()
    const setupFile = uploadBody.files.find((f) => f.name === 'setup')
    expect(setupFile).toBeDefined()
    expect(setupFile.type).toBe('SERVER_JS')
    expect(setupFile.source).toContain('storeEmailsAndAttachments')
    expect(setupFile.source).toContain('ScriptApp.newTrigger')
    expect(setupFile.source).toContain('everyHours(1)')
  })

  test('handleDeploy includes correct trigger function for calendar-to-sheets', async ({
    page,
  }) => {
    let uploadBody = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        uploadBody = JSON.parse(route.request().postData())
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    const setupFile = uploadBody.files.find((f) => f.name === 'setup')
    expect(setupFile).toBeDefined()
    expect(setupFile.type).toBe('SERVER_JS')
    expect(setupFile.source).toContain('syncAllCalendarsToSheetsGAS')
    expect(setupFile.source).toContain('ScriptApp.newTrigger')
    expect(setupFile.source).toContain('everyHours(1)')
  })

  test('handleDeploy success shows manual trigger setup instruction', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-ok')).toContainText('setup()')
    await expect(page.locator('.status-ok')).toContainText(
      'activate the hourly trigger'
    )
  })

  test('handleDeploy reuses stored project on redeploy without creating a new one', async ({
    page,
  }) => {
    // Pre-seed localStorage with an existing deployment
    await page.evaluate(() => {
      localStorage.setItem(
        'gas_copilot_deployed',
        JSON.stringify({
          'gmail-to-drive-by-labels\nMy Google Apps Script':
            'existing-script-id',
        })
      )
    })

    let projectCreated = false
    let verifiedExisting = false

    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'GET' && url.includes('/projects/existing-script-id')) {
        verifiedExisting = true
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            scriptId: 'existing-script-id',
            title: 'My Google Apps Script',
          }),
        })
      } else if (method === 'POST' && url.endsWith('/projects')) {
        projectCreated = true
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'new-id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(verifiedExisting).toBe(true)
    expect(projectCreated).toBe(false)
    await expect(page.locator('.result-link')).toHaveAttribute(
      'href',
      'https://script.google.com/d/existing-script-id/edit'
    )
  })

  test('handleDeploy creates new project if stored project was deleted', async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.setItem(
        'gas_copilot_deployed',
        JSON.stringify({
          'gmail-to-drive-by-labels\nMy Google Apps Script':
            'deleted-script-id',
        })
      )
    })

    let projectCreated = false

    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'GET' && url.includes('/projects/deleted-script-id')) {
        // Simulate project not found
        await route.fulfill({
          status: 404,
          body: JSON.stringify({ error: { message: 'Not found' } }),
        })
      } else if (method === 'POST' && url.endsWith('/projects')) {
        projectCreated = true
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'new-fallback-id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(projectCreated).toBe(true)
    await expect(page.locator('.result-link')).toHaveAttribute(
      'href',
      'https://script.google.com/d/new-fallback-id/edit'
    )
  })

  // ── handleDeploy – failure flows ────────────────────────────────────────────

  test('handleDeploy shows error when GitHub source file fetch fails', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-error')).toContainText(
      'Deployment failed'
    )
  })

  test('handleDeploy shows error when project creation fails with API error message', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'The caller does not have permission' },
        }),
      })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-error')).toContainText(
      'The caller does not have permission'
    )
    // Copyable error detail block is shown
    await expect(
      page.locator('.status-error details .error-detail')
    ).toContainText('The caller does not have permission')
    await expect(page.locator('.status-error .copy-btn')).toBeAttached()
  })

  test('handleDeploy shows enable-API link when Apps Script API is not enabled', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            message:
              'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retry.',
          },
        }),
      })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-error')).toContainText('Apps Script API')
    await expect(
      page.locator(
        '.status-error a[href="https://script.google.com/home/usersettings"]'
      )
    ).toBeVisible()
  })

  test('apiFetch shows HTTP status code when error body is not valid JSON', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'Internal Server Error',
      })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-error')).toContainText('HTTP 500')
  })

  test('handleDeploy shows error when content upload fails', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'new-id' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { message: 'Invalid content payload' },
          }),
        })
      } else {
        await route.continue()
      }
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-error')).toContainText(
      'Invalid content payload'
    )
  })

  test('deploy button resets to "Deploy to my account" after failed deploy', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 404, body: 'Not Found' })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-error')
    await expect(page.locator('#btn-deploy')).toHaveText('Deploy to my account')
  })

  // ── escapeHtml ──────────────────────────────────────────────────────────────

  test('escapeHtml escapes HTML entities in error messages', async ({
    page,
  }) => {
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: '<b>Quota</b> exceeded & "limit"' },
        }),
      })
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-error')

    // textContent shows the decoded literal characters
    const text = await page.locator('#status-msg').textContent()
    expect(text).toContain('<b>Quota</b> exceeded & "limit"')

    // innerHTML must use HTML entities — no injected raw tags
    const html = await page.locator('#status-msg').innerHTML()
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>Quota</b>')
  })

  // ── showStatus type classes ─────────────────────────────────────────────────

  test('error sign-in response shows status-error class', async ({ page }) => {
    // Clicking sign-in with empty client ID shows error immediately
    await page.fill('#client-id-input', '')
    await page.locator('#btn-signin').click()
    await expect(page.locator('#status-msg.status-error')).toBeVisible()
  })

  test('successful deploy shows status-ok class', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('#status-msg.status-ok')).toBeVisible()
  })

  test('status area is hidden on load', async ({ page }) => {
    await expect(page.locator('#status-area')).toBeHidden()
  })

  test('status area becomes visible after an action', async ({ page }) => {
    await page.locator('#client-id-input').fill('') // clear pre-filled value → triggers error
    await page.locator('#btn-signin').click() // empty client ID → error
    await expect(page.locator('#status-area')).toBeVisible()
  })

  // ── Multi-select (checkboxes) ───────────────────────────────────────────────

  test('script list uses checkboxes not radio buttons', async ({ page }) => {
    await expect(
      page.locator('#script-list input[type="checkbox"]')
    ).toHaveCount(2)
    await expect(page.locator('#script-list input[type="radio"]')).toHaveCount(
      0
    )
  })

  test('deploy button enables after sign-in with multiple scripts checked', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
  })

  test('deploy button re-disables when all scripts are unchecked', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
    // Uncheck the only selected script
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await expect(page.locator('#btn-deploy')).toBeDisabled()
  })

  test('deploy button stays enabled when one of two checked scripts is unchecked', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
    // Uncheck one — should remain enabled because one is still checked
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
  })

  test('deploying multiple scripts creates a project for each', async ({
    page,
  }) => {
    let createProjectCallCount = 0
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        createProjectCallCount++
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            scriptId: `mock-id-${createProjectCallCount}`,
          }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    // Two POST /projects calls — one per script
    expect(createProjectCallCount).toBe(2)
  })

  test('deploying multiple scripts shows a result link for each', async ({
    page,
  }) => {
    let projectIdCounter = 0
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        projectIdCounter++
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ scriptId: `project-${projectIdCounter}` }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    const links = page.locator('.result-link')
    await expect(links).toHaveCount(2)
    await expect(links.nth(0)).toHaveAttribute(
      'href',
      'https://script.google.com/d/project-1/edit'
    )
    await expect(links.nth(1)).toHaveAttribute(
      'href',
      'https://script.google.com/d/project-2/edit'
    )
  })

  test('multi-script deploy appends script name to each project title', async ({
    page,
  }) => {
    const capturedTitles = []
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        const body = JSON.parse(route.request().postData() || '{}')
        capturedTitles.push(body.title)
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ scriptId: 'x' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page.fill('#project-title-input', 'My Suite')
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(capturedTitles).toContain('My Suite – Gmail to Drive By Labels')
    expect(capturedTitles).toContain('My Suite – Calendar to Sheets')
  })

  test('single-script deploy does not modify the project title', async ({
    page,
  }) => {
    let capturedTitle = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        const body = JSON.parse(route.request().postData() || '{}')
        capturedTitle = body.title
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ scriptId: 'x' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
      } else {
        await route.continue()
      }
    })

    await signIn(page)
    await page.fill('#project-title-input', 'My Only Script')
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(capturedTitle).toBe('My Only Script')
  })
})
