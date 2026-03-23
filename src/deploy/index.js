/**
 * Deployment utilities for Google Apps Script projects.
 *
 * Provides functions for building project content and interacting with the
 * Google Apps Script REST API so that scripts from this repository can be
 * deployed directly from a user's web browser using their Google account.
 *
 * All API-calling functions accept an injectable `fetchFn` parameter so they
 * remain fully testable in Jest without mocking global `fetch`.
 */

'use strict'

const APPS_SCRIPT_API_BASE = 'https://script.googleapis.com/v1'

/**
 * Returns the catalog of deployable scripts included in this repository.
 * Each entry describes the script, its source files (relative to the
 * repository root `src/` directory), and the OAuth scopes it requires.
 *
 * @returns {Array<{id: string, name: string, description: string, files: string[], scopes: string[]}>}
 */
function getScriptCatalog() {
  return [
    {
      id: 'gmail-to-drive-by-labels',
      name: 'Gmail to Drive By Labels',
      description:
        'Automatically archives emails from specific Gmail labels into a ' +
        'Google Doc (text) and a Google Drive Folder (attachments). ' +
        'Features robust text cleaning and smart attachment de-duplication.',
      files: ['code.gs', 'config.gs'],
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/script.external_request',
      ],
    },
    {
      id: 'calendar-to-sheets',
      name: 'Calendar to Sheets',
      description:
        'Syncs Google Calendar events into a Google Sheet, keeping rows ' +
        'up to date on changes and deletions.',
      files: ['code.gs', 'config.gs'],
      scopes: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
    },
    {
      id: 'calendar-to-briefing-doc',
      name: 'Calendar to Briefing Doc',
      description:
        'Generates a weekly calendar briefing and emails it to configured ' +
        'recipients, grouped by day with times, locations, attendees, and ' +
        'conflict warnings. Shows which calendar each event comes from.',
      files: ['code.gs', 'config.gs'],
      scopes: [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.send',
      ],
    },
  ]
}

/**
 * Looks up a single script entry from the catalog by its `id`.
 *
 * @param {string} scriptId - The `id` of the script (e.g. 'calendar-to-sheets').
 * @returns {{id: string, name: string, description: string, files: string[], scopes: string[]}|null}
 *   The catalog entry, or `null` if not found.
 */
function getScriptById(scriptId) {
  if (!scriptId) return null
  const catalog = getScriptCatalog()
  return catalog.find((s) => s.id === scriptId) || null
}

/**
 * Builds the `files` array expected by the Apps Script REST API
 * (`projects.updateContent`).  Each file object has the shape:
 *   `{ name, type, source }`
 * where `type` is `'SERVER_JS'` for `.gs` files.
 *
 * @param {Array<{name: string, source: string}>} files
 *   File descriptors.  `name` should be the bare filename without extension
 *   (e.g. `'code'`).
 * @returns {{files: Array<{name: string, type: string, source: string}>}}
 * @throws {Error} When `files` is not a non-empty array or any entry is missing
 *   required fields.
 */
function buildProjectContent(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('files must be a non-empty array')
  }
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !f.name) {
      throw new Error('Each file must have a non-empty string name')
    }
    if (typeof f.source !== 'string') {
      throw new Error('Each file must have a string source')
    }
  }
  return {
    files: files.map((f) => ({
      name: f.name,
      type: 'SERVER_JS',
      source: f.source,
    })),
  }
}

/**
 * Creates a new Apps Script project via the REST API.
 *
 * @param {Function} fetchFn - A `fetch`-compatible function (injectable for testing).
 * @param {string} accessToken - A valid OAuth 2.0 access token with the
 *   `https://www.googleapis.com/auth/script.projects` scope.
 * @param {string} title - The display title for the new project.
 * @returns {Promise<{scriptId: string, title: string, createTime: string, updateTime: string}>}
 * @throws {Error} On missing arguments or a non-OK HTTP response.
 */
async function createProject(fetchFn, accessToken, title) {
  if (typeof fetchFn !== 'function')
    throw new Error('fetchFn must be a function')
  if (!accessToken) throw new Error('accessToken is required')
  if (!title) throw new Error('title is required')

  const response = await fetchFn(`${APPS_SCRIPT_API_BASE}/projects`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create project: ${response.status} ${text}`)
  }

  return response.json()
}

/**
 * Replaces the source files of an existing Apps Script project.
 *
 * @param {Function} fetchFn - A `fetch`-compatible function (injectable for testing).
 * @param {string} accessToken - A valid OAuth 2.0 access token.
 * @param {string} scriptId - The Apps Script project ID returned by `createProject`.
 * @param {{files: Array<{name: string, type: string, source: string}>}} content
 *   The project content object produced by `buildProjectContent`.
 * @returns {Promise<{files: Array}>} The updated project content as returned by
 *   the API.
 * @throws {Error} On missing arguments or a non-OK HTTP response.
 */
async function updateProjectContent(fetchFn, accessToken, scriptId, content) {
  if (typeof fetchFn !== 'function')
    throw new Error('fetchFn must be a function')
  if (!accessToken) throw new Error('accessToken is required')
  if (!scriptId) throw new Error('scriptId is required')
  if (!content || !Array.isArray(content.files)) {
    throw new Error('content must be an object with a files array')
  }

  const response = await fetchFn(
    `${APPS_SCRIPT_API_BASE}/projects/${scriptId}/content`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    }
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to update project content: ${response.status} ${text}`
    )
  }

  return response.json()
}

/**
 * High-level helper: creates a new Apps Script project and uploads the
 * provided source files in one call.
 *
 * @param {Function} fetchFn - A `fetch`-compatible function (injectable for testing).
 * @param {string} accessToken - A valid OAuth 2.0 access token with both
 *   `script.projects` and `script.projects.readonly` scopes.
 * @param {string} title - Display title for the project.
 * @param {Array<{name: string, source: string}>} files - File descriptors.
 * @returns {Promise<{scriptId: string, title: string, appsScriptUrl: string}>}
 *   A summary with the new project's ID and a direct link to open it.
 * @throws {Error} On any API or validation failure.
 */
async function deployScript(fetchFn, accessToken, title, files) {
  const project = await createProject(fetchFn, accessToken, title)
  const content = buildProjectContent(files)
  await updateProjectContent(fetchFn, accessToken, project.scriptId, content)
  return {
    scriptId: project.scriptId,
    title: project.title,
    appsScriptUrl: `https://script.google.com/d/${project.scriptId}/edit`,
  }
}

module.exports = {
  APPS_SCRIPT_API_BASE,
  getScriptCatalog,
  getScriptById,
  buildProjectContent,
  createProject,
  updateProjectContent,
  deployScript,
}
