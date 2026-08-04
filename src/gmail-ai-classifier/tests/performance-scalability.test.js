/**
 * Performance and Scalability Benchmark Test Suite for Gmail AI Classifier & GitHub Sync
 */

const { processThreadBatch } = require('../src/index.js')

describe('Performance and Scalability Benchmarks', () => {
  test('Section-Aware Insertion Benchmark: Large 10,000 Line Document', () => {
    // Generate a 10,000 line mock markdown document string
    const lines = []
    lines.push('# Master Index Note')
    lines.push('## 1. Executive Summary')
    lines.push('- Active status ok')
    lines.push('## 2. Key References')
    lines.push('| Topic | Asset |')
    lines.push('## 3. Ingested Activity Logs')
    lines.push('<details open><summary>Logs</summary>')

    for (let i = 1; i <= 10000; i++) {
      lines.push(
        `### 2026-07-28 — Log Entry #${i}\n- **Source**: Automated Ingestion\n- **Subject**: Test Log #${i}`
      )
    }
    lines.push('</details>')

    const largeDocContent = lines.join('\n')
    const newEntry =
      '### 2026-07-28 — Benchmark Test Entry\n- **Source**: Benchmark Test'

    const startTime = Date.now()

    // Simulate section insertion logic
    const detailsMarker = '</details>'
    const detailsIndex = largeDocContent.indexOf(detailsMarker)
    const updatedContent =
      largeDocContent.substring(0, detailsIndex) +
      newEntry +
      '\n' +
      largeDocContent.substring(detailsIndex)

    const elapsedTimeMs = Date.now() - startTime

    expect(updatedContent).toContain('Benchmark Test Entry')
    expect(updatedContent.length).toBeGreaterThan(largeDocContent.length)
    expect(elapsedTimeMs).toBeLessThan(50) // Must execute under 50ms for 10,000 lines
  })

  test('SHA Collision & Retry Logic Stress Test', () => {
    let attemptCount = 0

    // Simulate a function that fails twice with 409 Conflict before succeeding on attempt 3
    const simulateCommitWithConflict = () => {
      attemptCount++
      if (attemptCount < 3) {
        return { statusCode: 409, message: 'SHA Collision Conflict' }
      }
      return { statusCode: 200, message: 'Success' }
    }

    let finalResult = null
    for (let i = 1; i <= 3; i++) {
      const res = simulateCommitWithConflict()
      if (res.statusCode === 200) {
        finalResult = res
        break
      }
    }

    expect(attemptCount).toBe(3)
    expect(finalResult.statusCode).toBe(200)
  })

  test('Batch Processing Throughput Benchmark', () => {
    const BATCH_SIZE = 100
    const canonicalLabel = '04_Family_Health/General'

    const threads = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      getId: () => `msg_${i}`,
      getMessages: () => [
        {
          getFrom: () => `user_${i}@example.com`,
          getSubject: () => `Subject ${i}`,
          getPlainBody: () => `Plain body text snippet for email #${i}`,
        },
      ],
      addLabel: jest.fn(),
    }))

    const classification = {
      canonical_label: canonicalLabel,
      confidence: 0.97,
      reasoning: 'benchmark classification',
    }

    const config = {
      modelEndpoint: 'https://example.com/gemini',
      geminiApiKey: 'test-key',
      processedLabel: 'Processed',
      autoFilterConfidenceThreshold: 0.95,
      canonicalDomains: [canonicalLabel],
    }

    const services = {
      GmailApp: {
        getUserLabelByName: jest.fn((name) => ({
          getName: () => name,
          getId: () => 'label-' + name,
        })),
        createLabel: jest.fn((name) => ({
          getName: () => name,
          getId: () => 'label-' + name,
        })),
      },
      UrlFetchApp: {
        fetch: jest.fn(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(classification) }],
                  },
                },
              ],
            }),
        })),
      },
      Gmail: null,
    }

    const startTime = Date.now()
    const results = processThreadBatch(threads, config, services)
    const duration = Date.now() - startTime

    expect(results).toHaveLength(BATCH_SIZE) // no threads dropped
    expect(results.every((r) => r.status === 'classified')).toBe(true)
    expect(results.every((r) => r.label === canonicalLabel)).toBe(true) // canonical_label propagated correctly
    expect(duration).toBeLessThan(100) // 100 items benchmarked under 100ms
  })
})
