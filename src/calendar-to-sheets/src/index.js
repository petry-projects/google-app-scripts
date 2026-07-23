/**
 * Calendar to Sheets utilities.
 *
 * Designed to be testable outside of Google Apps Script by accepting
 * calendar and sheet objects that match the minimal interfaces used.
 */

function sanitizeValue(val) {
  // Prevent formula injection by prefixing formula metacharacters with '
  // Also catches leading whitespace/control chars followed by formula chars
  if (typeof val === 'string' && /^[\x00-\x20]*[=+\-@]/.test(val)) {
    return "'" + val
  }
  return val
}

function eventToRow(event) {
  const id = event.getId()
  const title = sanitizeValue(event.getTitle())
  const start = event.getStartTime().toISOString()
  const end = event.getEndTime().toISOString()
  const description = sanitizeValue(event.getDescription() || '')
  const location = sanitizeValue(event.getLocation() || '')
  const attendees = (event.getGuestList() || [])
    .map((g) => g.getEmail())
    .join(',')
  return [id, title, start, end, description, location, attendees]
}

function rowsToMap(rows) {
  // rows is array of arrays where first col is id
  const m = new Map()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r || !r[0]) continue
    m.set(r[0], { rowIndex: i + 2, values: r }) // assume header at row 1
  }
  return m
}

function rowsEqual(a, b) {
  // Compare only the first a.length columns. This allows b to have extra trailing
  // columns (e.g., user notes) without affecting equality.
  // If b is shorter than a, b[i] will be undefined and won't match a[i].
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]
    const valB = b[i]

    if (valA === valB) continue

    // Handle Date comparison (a is ISO string, b is Date object from sheet)
    if (typeof valA === 'string' && valB instanceof Date) {
      const dateA = new Date(valA)
      if (!isNaN(dateA) && dateA.getTime() === valB.getTime()) continue
    }

    // Handle sanitized formula comparison (a has leading ', b does not)
    if (
      typeof valA === 'string' &&
      valA.startsWith("'") &&
      valA.slice(1) === valB
    ) {
      continue
    }

    return false
  }
  return true
}

function ensureHeader(sheet) {
  // Ensure the sheet has a proper header row. If the sheet is empty or the first row
  // doesn't look like our expected header, create/replace it.
  const expectedHeader = [
    'id',
    'title',
    'start',
    'end',
    'description',
    'location',
    'attendees',
  ]

  const data = sheet.getDataRange().getValues()

  // If sheet is completely empty, add header
  if (!data || data.length === 0) {
    sheet.getRange(1, 1, 1, expectedHeader.length).setValues([expectedHeader])
    return
  }

  // Check if first row matches expected header
  const firstRow = data[0]
  const isValidHeader =
    firstRow &&
    firstRow.length >= expectedHeader.length &&
    firstRow[0] === 'id' &&
    firstRow[1] === 'title' &&
    firstRow[2] === 'start' &&
    firstRow[3] === 'end'

  // If first row doesn't look like a header, insert one at the top
  if (!isValidHeader) {
    sheet.insertRowBefore(1)
    sheet.getRange(1, 1, 1, expectedHeader.length).setValues([expectedHeader])
  }
}

/**
 * Upsert desired rows into the sheet: update rows whose content changed and
 * collect brand-new rows for insertion.
 *
 * @param {Map} desiredMap - Map of id -> desired row
 * @param {Map} existingMap - Map of id -> { rowIndex, values }
 * @param {Object} sheet - Sheet object
 * @returns {{ updateCount: number, rowsToInsert: Array }}
 */
function applyUpserts(desiredMap, existingMap, sheet) {
  let updateCount = 0
  const rowsToInsert = []

  for (const [id, row] of desiredMap.entries()) {
    if (!existingMap.has(id)) {
      rowsToInsert.push(row)
      continue
    }
    const ex = existingMap.get(id)
    if (!rowsEqual(row, ex.values)) {
      // update
      console.log('[syncCalendarToSheet] Updating row for event:', id)
      sheet.getRange(ex.rowIndex, 1, 1, row.length).setValues([row])
      updateCount++
    }
  }

  return { updateCount, rowsToInsert }
}

/**
 * Append new rows to the sheet, using a single batched setValues when possible
 * and falling back to appendRow for minimal sheet mocks.
 *
 * @param {Object} sheet - Sheet object
 * @param {Array} rowsToInsert - Rows to append
 */
function insertNewRows(sheet, rowsToInsert) {
  if (rowsToInsert.length === 0) return

  console.log(
    '[syncCalendarToSheet] Inserting new events:',
    rowsToInsert.length
  )
  if (typeof sheet.getLastRow === 'function') {
    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        rowsToInsert.length,
        rowsToInsert[0].length
      )
      .setValues(rowsToInsert)
  } else {
    rowsToInsert.forEach((row) => sheet.appendRow(row))
  }
}

/**
 * Determine which existing rows should be deleted: rows for events no longer
 * present, but only when their start time falls inside the synced [start,end]
 * window. Rows outside the window or with invalid dates are preserved.
 *
 * @param {Map} existingMap - Map of id -> { rowIndex, values }
 * @param {Map} desiredMap - Map of id -> desired row
 * @param {Date} start - Sync window start
 * @param {Date} end - Sync window end
 * @returns {Array<number>} Row indexes to delete
 */
function computeDeletableRows(existingMap, desiredMap, start, end) {
  const toDelete = []
  for (const [id, ex] of existingMap.entries()) {
    if (desiredMap.has(id)) continue

    // Only delete if the row has start/end columns and falls within [start,end]
    // Otherwise, preserve historical rows outside the sync window
    const rowStart = ex.values[2] // start is at index 2
    const rowEnd = ex.values[3] // end is at index 3
    if (!rowStart || !rowEnd) {
      // If no valid date columns, don't delete (preserve historical data)
      console.log(
        '[syncCalendarToSheet] Preserving event with invalid dates:',
        id
      )
      continue
    }

    const rowStartTime = new Date(rowStart)
    const rowEndTime = new Date(rowEnd)
    // Delete if event overlaps the sync window (event.start <= window.end AND event.end >= window.start)
    if (
      !Number.isNaN(rowStartTime.getTime()) &&
      !Number.isNaN(rowEndTime.getTime()) &&
      rowStartTime <= end &&
      rowEndTime >= start
    ) {
      console.log('[syncCalendarToSheet] Marking event for deletion:', id)
      toDelete.push(ex.rowIndex)
    } else {
      console.log(
        '[syncCalendarToSheet] Preserving event outside sync window:',
        id
      )
    }
  }
  return toDelete
}

async function syncCalendarToSheet(
  calendar,
  sheet,
  {
    start = new Date(0),
    end = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  } = {}
) {
  // Ensure header row exists
  ensureHeader(sheet)
  console.log('[syncCalendarToSheet] Starting sync with date range:', {
    start,
    end,
  })
  // Fetch events
  const events = calendar.getEvents(start, end)
  console.log('[syncCalendarToSheet] Fetched events:', events.length)
  const desired = events.map(eventToRow)
  const desiredMap = new Map(desired.map((r) => [r[0], r]))

  // Read existing rows
  const data = sheet.getDataRange().getValues()
  const body = data.slice(1)
  console.log('[syncCalendarToSheet] Existing rows:', body.length)
  const existingMap = rowsToMap(body)

  // Upsert: update changed rows, collect new rows, then insert them
  const { updateCount, rowsToInsert } = applyUpserts(
    desiredMap,
    existingMap,
    sheet
  )
  insertNewRows(sheet, rowsToInsert)

  console.log(
    '[syncCalendarToSheet] Updates:',
    updateCount,
    'Inserts:',
    rowsToInsert.length
  )

  // Delete rows for events that no longer exist, but only if they fall within
  // the synced time window to avoid deleting rows from events outside [start,end]
  const toDelete = computeDeletableRows(existingMap, desiredMap, start, end)
  // delete from bottom to top
  console.log('[syncCalendarToSheet] Deleting rows:', toDelete.length)
  toDelete.sort((a, b) => b - a).forEach((r) => sheet.deleteRow(r))
  console.log('[syncCalendarToSheet] Sync complete')
}

module.exports = {
  eventToRow,
  syncCalendarToSheet,
  rowsEqual,
  rowsToMap,
  ensureHeader,
}
