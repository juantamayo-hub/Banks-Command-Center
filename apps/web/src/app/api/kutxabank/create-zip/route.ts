/**
 * POST /api/kutxabank/create-zip
 *
 * Called from n8n after converting files to base64 in JSON.
 * Creates a single ZIP (no password) with all files and returns binary.
 *
 * Body:
 *   files        - array of { data: base64, fileName: string }
 *   zipFilename  - desired output filename
 */

import JSZip from 'jszip'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ZipFile {
  data: string      // base64
  fileName: string
}

export async function POST(req: Request) {
  let body: { files?: ZipFile[]; dni?: string; zipFilename?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const files = body.files ?? []
  const zipFilename = (body.zipFilename ?? 'Kutxabank.zip').trim()

  if (files.length === 0) {
    return Response.json({ error: 'No files provided' }, { status: 400 })
  }

  try {
    const zip = new JSZip()

    for (const file of files) {
      // data arrives as base64 (re-encoded in n8n Code node)
      const buf = Buffer.from(file.data, 'base64')
      zip.file(file.fileName, buf)
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })

    return new Response(zipBuffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Content-Length': String(zipBuffer.length),
      },
    })
  } catch (err) {
    console.error('[create-zip] error:', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'ZIP creation failed' },
      { status: 500 }
    )
  }
}
