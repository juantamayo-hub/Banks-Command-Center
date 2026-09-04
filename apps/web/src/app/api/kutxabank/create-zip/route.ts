/**
 * POST /api/kutxabank/create-zip
 *
 * Called from n8n. Receives PDFs as base64, creates a single
 * password-protected ZIP (ZipCrypto, password = DNI) and returns binary.
 *
 * Body:
 *   files        - array of { data: base64, fileName: string }
 *   dni          - password for the ZIP (DNI del cliente)
 *   zipFilename  - desired output filename
 */

import { createRequire } from 'node:module'

// createRequire bypasses webpack/turbopack bundling entirely —
// loads archiver directly from node_modules at runtime
const _require = createRequire(process.cwd() + '/')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ZipFile {
  data: string
  fileName: string
}

let _registered = false
function getArchiver() {
  const archiver = _require('archiver')
  if (!_registered) {
    const plugin = _require('archiver-zip-encrypted')
    archiver.registerFormat('zip-encrypted', plugin)
    _registered = true
  }
  return archiver
}

export async function POST(req: Request) {
  let body: { files?: ZipFile[]; dni?: string; zipFilename?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const files = body.files ?? []
  const dni = (body.dni ?? 'bayteca').trim()
  const zipFilename = (body.zipFilename ?? 'Kutxabank.zip').trim()

  if (files.length === 0) {
    return Response.json({ error: 'No files provided' }, { status: 400 })
  }

  try {
    const archiver = getArchiver()

    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []

      const archive = archiver.create('zip-encrypted', {
        zlib: { level: 8 },
        encryptionMethod: 'zipCrypto',
        password: dni,
      })

      archive.on('data', (chunk: Buffer) => chunks.push(chunk))
      archive.on('end', () => resolve(Buffer.concat(chunks)))
      archive.on('error', reject)

      for (const file of files) {
        const buf = Buffer.from(file.data, 'base64')
        archive.append(buf, { name: file.fileName })
      }

      archive.finalize()
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
