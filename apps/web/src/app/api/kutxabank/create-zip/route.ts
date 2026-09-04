/**
 * POST /api/kutxabank/create-zip
 *
 * Called from n8n after downloading individual files from Google Drive.
 * Creates a single password-protected ZIP (ZipCrypto, password = DNI)
 * and returns it as binary.
 *
 * Body:
 *   files        - array of { data: base64, fileName: string }
 *   dni          - password for the ZIP (DNI del cliente)
 *   zipFilename  - desired output filename
 */

// force-dynamic prevents build-time module evaluation (archiver has side effects)
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ZipFile {
  data: string      // base64
  fileName: string
}

let _formatRegistered = false

function getArchiver() {
  // Late-require to avoid Turbopack bundling issues
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const archiver = require('archiver')
  if (!_formatRegistered) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const plugin = require('archiver-zip-encrypted')
    archiver.registerFormat('zip-encrypted', plugin)
    _formatRegistered = true
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
