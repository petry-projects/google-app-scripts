// @ts-check
'use strict'

/**
 * Playwright end-to-end tests for deploy/index.html.
 *
 * External dependencies are fully mocked:
 *   - Google Identity Services (GIS) script blocked via page.route() and
 *     replaced with a synchronous mock injected via addInitScript.
 *   - Google APIs (gapi / Drive Picker) script blocked and replaced with mock.
 *   - GitHub raw file requests intercepted via page.route().
 *   - Apps Script REST API requests intercepted via page.route().
 */

const { test, expect } = require('@playwright/test')
const path = require('path')

const PAGE_URL = `file://${path.resolve(__dirname, '..', 'index.html')}`

// ── GIS OAuth mock ────────────────────────────────────────────────────────────

/**
 * Injected into the browser before any page scripts run.
 * Sets window.google.accounts.oauth2 with a synchronous stub.
 *
 * Modes (controlled via window.__authMode):
 *   'success' – immediately calls callback with a fake access_token
 *   'failure' – immediately calls callback with an error
 */
function injectGisMock() {
  window.__authMode = 'success'
  window.__clientIdUsed = null

  // Use || {} so this is safe to call before or after injectGapiMock.
  window.google = window.google || {}
  window.google.accounts = {
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
  }
}

// ── gapi / Drive Picker mock ──────────────────────────────────────────────────

/**
 * Injected after injectGisMock.
 * Provides window.gapi and window.google.picker stubs so that
 * openPicker() and the config panel work without real Google APIs.
 */
function injectGapiMock() {
  window.__pickerOpened = false
  window.__pickerViewId = null
  window.__pickerCallback = null

  // gapi.load immediately invokes the callback (picker module "loaded")
  window.gapi = {
    load(module, callback) {
      if (typeof callback === 'function') callback()
    },
  }

  // Use || {} so this is safe to call before or after injectGisMock.
  window.google = window.google || {}
  window.google.picker = {
    ViewId: {
      DOCUMENTS: 'documents',
      FOLDERS: 'folders',
      SPREADSHEETS: 'spreadsheets',
    },
    Response: {
      ACTION: 'action',
      DOCUMENTS: 'docs',
    },
    Action: {
      PICKED: 'picked',
    },
    Document: {
      ID: 'id',
      NAME: 'name',
    },
    DocsView: class {
      constructor(viewId) {
        window.__pickerViewId = viewId
      }
      setSelectFolderEnabled() {
        return this
      }
      setIncludeFolders() {
        return this
      }
    },
    PickerBuilder: class {
      addView() {
        return this
      }
      setOAuthToken() {
        return this
      }
      setCallback(cb) {
        window.__pickerCallback = cb
        return this
      }
      build() {
        return {
          setVisible(v) {
            if (v) window.__pickerOpened = true
          },
        }
      }
    },
  }
}

// ── Route helpers ─────────────────────────────────────────────────────────────

/** Sets up routes for a complete, successful deploy + configure flow. */
async function mockSuccessfulDeploy(page) {
  // GitHub raw source files
  await page.route('https://raw.githubusercontent.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/plain',
      body: '// mock script source\nfunction main() {}',
    })
  })

  // Apps Script REST API — project creation, content upload, and content read
  await page.route('https://script.googleapis.com/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()

    if (method === 'POST' && url.endsWith('/projects')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scriptId: 'mock-project-id-abc' }),
      })
    } else if (method === 'GET' && url.includes('/content')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          files: [
            { name: 'appsscript', type: 'JSON', source: '{}' },
            { name: 'code', type: 'SERVER_JS', source: '// code' },
            { name: 'config', type: 'SERVER_JS', source: '// config' },
          ],
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

  // Gmail labels API
  await page.route('https://gmail.googleapis.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        labels: [
          { id: 'Label_1', name: 'inbox' },
          { id: 'Label_2', name: 'archive' },
          { id: 'Label_3', name: 'work' },
        ],
      }),
    })
  })

  // Calendar list API
  await page.route('https://www.googleapis.com/calendar/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { id: 'primary', summary: 'Primary Calendar' },
          { id: 'work@example.com', summary: 'Work' },
        ],
      }),
    })
  })
}

/** Clicks Sign in. */
async function signIn(page) {
  await page.locator('#btn-signin').click()
}

// ── Test suite ────────────────────────────────────────────────────────────────

test.describe('deploy index.html', () => {
  test.beforeEach(async ({ page }) => {
    // Block external scripts so they cannot overwrite our mocks
    await page.route('https://accounts.google.com/**', (route) => route.abort())
    await page.route('https://apis.google.com/**', (route) => route.abort())
    // Abort Gmail / Calendar by default; individual tests may override.
    await page.route('https://gmail.googleapis.com/**', (route) =>
      route.abort()
    )
    await page.route('https://www.googleapis.com/calendar/**', (route) =>
      route.abort()
    )

    // Inject mocks before page scripts run (order matters: GIS first, then gapi)
    await page.addInitScript(injectGisMock)
    await page.addInitScript(injectGapiMock)

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

  test('renders two numbered step badges', async ({ page }) => {
    const badges = page.locator('.step-badge')
    await expect(badges).toHaveCount(2)
    await expect(badges.nth(0)).toHaveText('1')
    await expect(badges.nth(1)).toHaveText('2')
  })

  test('renders sign-in button', async ({ page }) => {
    await expect(page.locator('#btn-signin')).toBeVisible()
    await expect(page.locator('#btn-signin')).toContainText(
      'Sign in with Google'
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

  test('deploy button enables after sign-in with script selected', async ({
    page,
  }) => {
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
  })

  // ── handleSignIn ────────────────────────────────────────────────────────────

  test('handleSignIn uses the hardcoded Petry-Projects client ID', async ({
    page,
  }) => {
    await signIn(page)
    const clientId = await page.evaluate(() => window.__clientIdUsed)
    expect(clientId).toBe(
      '873060687431-smmudbpd5rlogt0r7immp0u3tdqb2t3p.apps.googleusercontent.com'
    )
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

  test('handleDeploy success shows the script name in the message', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await expect(page.locator('.status-ok')).toContainText(
      'Gmail to Drive By Labels'
    )
  })

  test('handleDeploy renders a per-script card with Deployed successfully', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')
    // Each project gets its own card showing "Deployed successfully"
    const card = page.locator('.result-link').first().locator('..')
    await expect(card).toContainText('Deployed successfully')
  })

  test('handleDeploy shows setup CTA when setup has not been confirmed', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')
    // CTA box should be visible with numbered steps and the confirm button
    await expect(page.locator('[id^="setup-cta-"]')).toBeVisible()
    await expect(page.locator('[id^="setup-cta-"]')).toContainText(
      'One more step'
    )
    await expect(
      page.locator('button:has-text("Done — I ran setup()")')
    ).toBeVisible()
  })

  test('clicking confirm button replaces CTA with collapsible trigger-review link', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('[id^="setup-cta-"]')
    await page.locator('button:has-text("Done — I ran setup()")').click()
    await expect(page.locator('[id^="setup-done-"]')).toBeVisible()
    await expect(page.locator('[id^="setup-done-"]')).toContainText(
      'previously enabled the hourly trigger'
    )
    await expect(page.locator('[id^="setup-done-"]')).toContainText(
      'Click here to review instructions'
    )
    await expect(page.locator('[id^="setup-cta-"]')).toHaveCount(0)
  })

  test('handleDeploy shows collapsible trigger-review when setup already confirmed', async ({
    page,
  }) => {
    // Pre-seed setup confirmation in localStorage so the CTA is skipped
    await mockSuccessfulDeploy(page)
    await page.evaluate(() => {
      localStorage.setItem(
        'gas_copilot_setup_done',
        JSON.stringify({ 'mock-project-id-abc': true })
      )
    })
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')
    await expect(page.locator('[id^="setup-done-"]')).toBeVisible()
    await expect(page.locator('[id^="setup-done-"]')).toContainText(
      'previously enabled the hourly trigger'
    )
    await expect(page.locator('[id^="setup-done-"]')).toContainText(
      'Click here to review instructions'
    )
    await expect(page.locator('[id^="setup-cta-"]')).toHaveCount(0)
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
    expect(parsed).toHaveProperty('executionApi', { access: 'MYSELF' })
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
          'gmail-to-drive-by-labels\nPetry-Projects – Gmail to Drive By Labels':
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
            title: 'Petry-Projects – Gmail to Drive By Labels',
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
          'gmail-to-drive-by-labels\nPetry-Projects – Gmail to Drive By Labels':
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
    await page.evaluate(() => {
      window.__authMode = 'failure'
    })
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
    await page.evaluate(() => {
      window.__authMode = 'failure'
    })
    await page.locator('#btn-signin').click()
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

  test('multi-script deploy uses Petry-Projects prefix for each project title', async ({
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
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(capturedTitles).toContain(
      'Petry-Projects – Gmail to Drive By Labels'
    )
    expect(capturedTitles).toContain('Petry-Projects – Calendar to Sheets')
  })

  test('single-script deploy uses Petry-Projects prefix for project title', async ({
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
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    expect(capturedTitle).toBe('Petry-Projects – Gmail to Drive By Labels')
  })

  // ── Step 4: Configure ───────────────────────────────────────────────────────

  test('Step 4 card appears after successful deployment', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')
    // Step 4 card should be in the DOM
    await expect(page.locator('#step4-card')).toBeVisible()
    await expect(page.locator('#step4-card')).toContainText('Configure scripts')
  })

  test('Step 4 card shows step badge with number 4', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await expect(page.locator('#step4-card .step-badge')).toHaveText('4')
  })

  test('Step 4 shows a config panel for gmail-to-drive-by-labels', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await expect(page.locator('#step4-card')).toContainText(
      'Gmail to Drive By Labels'
    )
    await expect(page.locator('[id^="config-panel-"]')).toHaveCount(1)
  })

  test('Step 4 shows a config panel for calendar-to-sheets', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await expect(page.locator('#step4-card')).toContainText(
      'Calendar to Sheets'
    )
    await expect(page.locator('[id^="config-panel-"]')).toHaveCount(1)
  })

  test('Step 4 shows two config panels when both scripts are deployed', async ({
    page,
  }) => {
    let counter = 0
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        counter++
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: `id-${counter}` }),
        })
      } else if (url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })
    await page.route('https://gmail.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ labels: [] }),
      })
    })
    await page.route(
      'https://www.googleapis.com/calendar/**',
      async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ items: [] }),
        })
      }
    )

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')

    await expect(page.locator('[id^="config-panel-"]')).toHaveCount(2)
  })

  test('Gmail labels populate the trigger and processed label dropdowns', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')

    // Wait for a config row to appear (labels loaded)
    await page.waitForSelector('.config-row')

    // Trigger label dropdown should contain the mocked labels
    const triggerSelect = page
      .locator('.config-row [name="triggerLabel"]')
      .first()
    await expect(triggerSelect).toContainText('inbox')
    await expect(triggerSelect).toContainText('archive')
    await expect(triggerSelect).toContainText('work')

    // Processed label dropdown should also be populated
    const processedSelect = page
      .locator('.config-row [name="processedLabel"]')
      .first()
    await expect(processedSelect).toContainText('inbox')
  })

  test('Calendar list populates the calendar dropdown', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')

    await page.waitForSelector('.config-row')

    const calSelect = page.locator('.config-row [name="calendarId"]').first()
    await expect(calSelect).toContainText('Primary Calendar')
    await expect(calSelect).toContainText('Work')
  })

  test('initial config row is added automatically after deploy', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    await expect(page.locator('.config-row')).toHaveCount(1)
  })

  test('clicking Add entry adds a new config row for gmail-to-drive-by-labels', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    await page.locator('[id^="add-btn-"]').first().click()
    await expect(page.locator('.config-row')).toHaveCount(2)
  })

  test('clicking Remove deletes the config row', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    // Add a second row so there is one left after removal
    await page.locator('[id^="add-btn-"]').first().click()
    await expect(page.locator('.config-row')).toHaveCount(2)

    // Remove the first row
    await page.locator('.btn-danger').first().click()
    await expect(page.locator('.config-row')).toHaveCount(1)
  })

  test('Step 4 shows Save Configuration button', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')

    await expect(
      page.locator('button:has-text("Save Configuration")')
    ).toBeVisible()
  })

  test('Save Configuration calls GET content then PUT content on Apps Script API', async ({
    page,
  }) => {
    const apiCalls = []
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      apiCalls.push({ method, url })
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'proj-abc' }),
        })
      } else if (method === 'GET' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            files: [
              { name: 'appsscript', type: 'JSON', source: '{}' },
              { name: 'code', type: 'SERVER_JS', source: '// code' },
              { name: 'config', type: 'SERVER_JS', source: '// old config' },
            ],
          }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })
    await page.route('https://gmail.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ labels: [{ id: 'L1', name: 'mylabel' }] }),
      })
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    await page.locator('button:has-text("Save Configuration")').click()
    await page.waitForSelector('[id^="save-status-"]:has-text("saved")')

    const contentGetCalls = apiCalls.filter(
      (c) => c.method === 'GET' && c.url.includes('/projects/proj-abc/content')
    )
    const contentPutCalls = apiCalls.filter(
      (c) => c.method === 'PUT' && c.url.includes('/projects/proj-abc/content')
    )
    expect(contentGetCalls.length).toBeGreaterThanOrEqual(1)
    expect(contentPutCalls.length).toBeGreaterThanOrEqual(1)
  })

  test('Save Configuration writes new config.gs and keeps other files', async ({
    page,
  }) => {
    let lastPutBody = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'proj-xyz' }),
        })
      } else if (method === 'GET' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            files: [
              { name: 'appsscript', type: 'JSON', source: '{}' },
              { name: 'code', type: 'SERVER_JS', source: '// code' },
              { name: 'config', type: 'SERVER_JS', source: '// old' },
            ],
          }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        lastPutBody = JSON.parse(route.request().postData())
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })
    await page.route('https://gmail.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ labels: [{ id: 'L1', name: 'work' }] }),
      })
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    // Select a label value and click Save
    await page
      .locator('.config-row [name="triggerLabel"]')
      .first()
      .selectOption('work')
    await page
      .locator('.config-row [name="processedLabel"]')
      .first()
      .selectOption('work')
    await page.locator('button:has-text("Save Configuration")').click()
    await page.waitForSelector('[id^="save-status-"]:has-text("saved")')

    expect(lastPutBody).not.toBeNull()
    // appsscript and code files must be preserved
    expect(lastPutBody.files.find((f) => f.name === 'appsscript')).toBeDefined()
    expect(lastPutBody.files.find((f) => f.name === 'code')).toBeDefined()
    // config file must be the new one
    const configFile = lastPutBody.files.find((f) => f.name === 'config')
    expect(configFile).toBeDefined()
    expect(configFile.source).toContain('getProcessConfig')
    expect(configFile.source).toContain('"work"')
    // old config source must be replaced
    expect(configFile.source).not.toContain('// old')
  })

  test('Save Configuration for calendar-to-sheets writes SYNC_CONFIGS', async ({
    page,
  }) => {
    let lastPutBody = null
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (method === 'POST' && url.endsWith('/projects')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ scriptId: 'cal-proj' }),
        })
      } else if (method === 'GET' && url.includes('/content')) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            files: [{ name: 'config', type: 'SERVER_JS', source: '// old' }],
          }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        lastPutBody = JSON.parse(route.request().postData())
        await route.fulfill({ status: 200, body: '{}' })
      } else {
        await route.continue()
      }
    })
    await page.route(
      'https://www.googleapis.com/calendar/**',
      async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            items: [{ id: 'primary', summary: 'Primary' }],
          }),
        })
      }
    )

    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    await page
      .locator('.config-row [name="calendarId"]')
      .first()
      .selectOption('primary')
    await page.locator('button:has-text("Save Configuration")').click()
    await page.waitForSelector('[id^="save-status-"]:has-text("saved")')

    expect(lastPutBody).not.toBeNull()
    const configFile = lastPutBody.files.find((f) => f.name === 'config')
    expect(configFile).toBeDefined()
    expect(configFile.source).toContain('SYNC_CONFIGS')
    expect(configFile.source).toContain('"primary"')
  })

  test('Save Configuration shows success message on success', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    await page.locator('button:has-text("Save Configuration")').click()
    await page.waitForSelector('[id^="save-status-"]:has-text("saved")')

    await expect(page.locator('[id^="save-status-"]').first()).toContainText(
      'Configuration saved'
    )
  })

  test('Save Configuration shows error message on failure', async ({
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
          body: JSON.stringify({ scriptId: 'err-proj' }),
        })
      } else if (method === 'PUT' && url.includes('/content')) {
        await route.fulfill({ status: 200, body: '{}' })
      } else if (method === 'GET' && url.includes('/content')) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { message: 'Permission denied' } }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route('https://gmail.googleapis.com/**', async (route) => {
      await route.fulfill({
        status: 200,
        body: JSON.stringify({ labels: [] }),
      })
    })

    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    // Labels loaded with empty list, so no rows needed from API
    // (the initial row still appears, just with no label options)
    await page.waitForSelector('.config-row')

    await page.locator('button:has-text("Save Configuration")').click()
    await page.waitForSelector(
      '[id^="save-status-"]:has-text("Permission denied")'
    )

    await expect(page.locator('[id^="save-status-"]').first()).toContainText(
      'Permission denied'
    )
  })

  test('buildGmailConfigSource generates correct config.gs source', async ({
    page,
  }) => {
    const source = await page.evaluate(() => {
      return window.buildGmailConfigSource([
        {
          triggerLabel: 'my-label',
          processedLabel: 'archived',
          docId: 'doc123',
          folderId: 'folder456',
          batchSize: '100',
        },
      ])
    })
    expect(source).toContain('function getProcessConfig()')
    expect(source).toContain('"my-label"')
    expect(source).toContain('"archived"')
    expect(source).toContain('"doc123"')
    expect(source).toContain('"folder456"')
    expect(source).toContain('100')
  })

  test('buildGmailConfigSource uses default batchSize of 250 when not provided', async ({
    page,
  }) => {
    const source = await page.evaluate(() => {
      return window.buildGmailConfigSource([
        {
          triggerLabel: 'lbl',
          processedLabel: 'done',
          docId: 'd',
          folderId: 'f',
          batchSize: '',
        },
      ])
    })
    expect(source).toContain('250')
  })

  test('buildCalendarConfigSource generates correct config.gs source', async ({
    page,
  }) => {
    const source = await page.evaluate(() => {
      return window.buildCalendarConfigSource([
        {
          calendarId: 'cal@example.com',
          spreadsheetId: 'sheet789',
          sheetName: 'MySheet',
        },
      ])
    })
    expect(source).toContain('SYNC_CONFIGS')
    expect(source).toContain('"cal@example.com"')
    expect(source).toContain('"sheet789"')
    expect(source).toContain('"MySheet"')
  })

  test('buildCalendarConfigSource uses Sheet1 as default sheetName', async ({
    page,
  }) => {
    const source = await page.evaluate(() => {
      return window.buildCalendarConfigSource([
        {
          calendarId: 'c',
          spreadsheetId: 's',
          sheetName: '',
        },
      ])
    })
    expect(source).toContain('"Sheet1"')
  })

  test('Step 4 is not shown before deployment', async ({ page }) => {
    await expect(page.locator('#step4-card')).toHaveCount(0)
    await expect(page.locator('#config-area')).toBeAttached()
    await expect(page.locator('#config-area')).toBeEmpty()
  })

  test('re-deploying replaces previous Step 4 card', async ({ page }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')

    // Deploy again
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('.status-ok')

    // Should still be exactly one Step 4 card
    await expect(page.locator('#step4-card')).toHaveCount(1)
  })

  // ── Select all ──────────────────────────────────────────────────────────────

  test('Select all button is present in script list', async ({ page }) => {
    await expect(page.locator('#btn-select-all')).toBeVisible()
    await expect(page.locator('#btn-select-all')).toHaveText('Select all')
  })

  test('Select all checks all script checkboxes', async ({ page }) => {
    await page.locator('#btn-select-all').click()
    const checkboxes = page.locator('input[name="script"]')
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).toBeChecked()
    }
  })

  test('Select all button label becomes "Deselect all" when all checked', async ({
    page,
  }) => {
    await page.locator('#btn-select-all').click()
    await expect(page.locator('#btn-select-all')).toHaveText('Deselect all')
  })

  test('Deselect all unchecks all script checkboxes', async ({ page }) => {
    // First check all
    await page.locator('#btn-select-all').click()
    // Then deselect all
    await page.locator('#btn-select-all').click()
    const checkboxes = page.locator('input[name="script"]')
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).not.toBeChecked()
    }
  })

  test('Select all enables deploy button after sign-in', async ({ page }) => {
    await signIn(page)
    await page.locator('#btn-select-all').click()
    await expect(page.locator('#btn-deploy')).toBeEnabled()
  })

  test('Select all label updates when individual checkboxes are toggled', async ({
    page,
  }) => {
    // Select all then uncheck one — label should revert to "Select all"
    await page.locator('#btn-select-all').click()
    await expect(page.locator('#btn-select-all')).toHaveText('Deselect all')
    await page
      .locator('#script-list input[value="gmail-to-drive-by-labels"]')
      .click()
    await expect(page.locator('#btn-select-all')).toHaveText('Select all')
  })

  // ── Auto-set sheet name from calendar name ──────────────────────────────────

  test('selecting a calendar auto-fills the sheet name input', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    const calSelect = page.locator('.config-row [name="calendarId"]').first()
    await calSelect.selectOption('work@example.com')

    const sheetName = page.locator('.config-row [name="sheetName"]').first()
    await expect(sheetName).toHaveValue('Work')
  })

  test('auto-fill does not overwrite sheet name when calendar is deselected', async ({
    page,
  }) => {
    await mockSuccessfulDeploy(page)
    await signIn(page)
    await page.locator('#script-list input[value="calendar-to-sheets"]').click()
    await page.locator('#btn-deploy').click()
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    // Selecting "— select —" (empty value) should not change the sheet name
    const calSelect = page.locator('.config-row [name="calendarId"]').first()
    await calSelect.selectOption('primary')
    const sheetName = page.locator('.config-row [name="sheetName"]').first()
    await expect(sheetName).toHaveValue('Primary Calendar')

    // Selecting empty should not reset
    await calSelect.selectOption('')
    await expect(sheetName).toHaveValue('Primary Calendar')
  })

  // ── Step 4 appears on sign-in if previously deployed ───────────────────────

  test('Step 4 appears automatically on sign-in when projects were already deployed', async ({
    page,
  }) => {
    // Pre-seed localStorage with a previously deployed project
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          'calendar-to-sheets\nPetry-Projects – Calendar to Sheets':
            'existing-proj-id',
        })
      )
    }, 'gas_copilot_deployed')

    await mockSuccessfulDeploy(page)
    await signIn(page)

    // Step 4 should appear without clicking Deploy
    await page.waitForSelector('#step4-card')
    await expect(page.locator('#step4-card')).toBeVisible()
  })

  test('Step 4 pre-populates calendar rows from existing config.gs', async ({
    page,
  }) => {
    // Pre-seed localStorage
    await page.evaluate((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          'calendar-to-sheets\nPetry-Projects – Calendar to Sheets':
            'existing-proj-id',
        })
      )
    }, 'gas_copilot_deployed')

    // Return an existing config.gs with a known SYNC_CONFIGS
    await page.route('https://raw.githubusercontent.com/**', async (route) => {
      await route.fulfill({ status: 200, body: '// code' })
    })
    await page.route('https://script.googleapis.com/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()
      if (
        method === 'GET' &&
        url.includes('/projects/existing-proj-id/content')
      ) {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            files: [
              {
                name: 'config',
                type: 'SERVER_JS',
                source:
                  'var SYNC_CONFIGS = [{ spreadsheetId: "sheet-abc", sheetName: "MySheet", calendarId: "primary" }];\n',
              },
            ],
          }),
        })
      } else {
        await route.continue()
      }
    })
    await page.route(
      'https://www.googleapis.com/calendar/**',
      async (route) => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            items: [{ id: 'primary', summary: 'Primary Calendar' }],
          }),
        })
      }
    )

    await signIn(page)
    await page.waitForSelector('#step4-card')
    await page.waitForSelector('.config-row')

    // The existing entry should be pre-populated
    const calSelect = page.locator('.config-row [name="calendarId"]').first()
    await expect(calSelect).toHaveValue('primary')

    const sheetNameInput = page
      .locator('.config-row [name="sheetName"]')
      .first()
    await expect(sheetNameInput).toHaveValue('MySheet')
  })

  test('parseCalendarConfig correctly parses SYNC_CONFIGS source', async ({
    page,
  }) => {
    const entries = await page.evaluate(() => {
      return window.parseCalendarConfig(
        'var SYNC_CONFIGS = [{ spreadsheetId: "s1", sheetName: "Sh", calendarId: "c1" }];\n'
      )
    })
    expect(entries).toEqual([
      { spreadsheetId: 's1', sheetName: 'Sh', calendarId: 'c1' },
    ])
  })

  test('parseGmailConfig correctly parses getProcessConfig source', async ({
    page,
  }) => {
    const entries = await page.evaluate(() => {
      return window.parseGmailConfig(
        'function getProcessConfig() { return [{ triggerLabel: "t", processedLabel: "p", docId: "d", folderId: "f", batchSize: 50 }]; }\n'
      )
    })
    expect(entries).toEqual([
      {
        triggerLabel: 't',
        processedLabel: 'p',
        docId: 'd',
        folderId: 'f',
        batchSize: 50,
      },
    ])
  })
})
