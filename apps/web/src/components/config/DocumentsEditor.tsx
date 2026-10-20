'use client'

import { useState, useTransition } from 'react'
import { deleteDocument, saveDocument } from '@/app/actions/bankConfig'
import type { RequiredDocument } from '@/lib/bankConfig'
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT } from './ui'

type Draft = { id?: string; drive_code: string; label: string; required: boolean; ocr: boolean; extract_field: string }

function Row({ slug, doc, canEdit, onDone }: { slug: string; doc: Draft; canEdit: boolean; onDone?: () => void }) {
  const [editing, setEditing] = useState(!doc.id)
  const [d, setD] = useState(doc)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save() {
    setError(null)
    start(async () => {
      const r = await saveDocument({ ...d, bank_slug: slug })
      if (!r.ok) setError(r.error)
      else {
        setEditing(false)
        onDone?.()
      }
    })
  }

  if (!editing) {
    return (
      <tr className="border-t border-gray-100">
        <td className="py-2 pr-3 font-mono text-xs text-gray-800">{d.drive_code}</td>
        <td className="py-2 pr-3 text-sm text-gray-800">{d.label}</td>
        <td className="py-2 pr-3 text-xs">{d.required ? 'Obligatorio' : <span className="text-gray-400">Opcional</span>}</td>
        <td className="py-2 pr-3 text-xs text-gray-600">{d.ocr ? d.extract_field || 'Sí' : '—'}</td>
        <td className="py-2 text-right whitespace-nowrap">
          {canEdit && (
            <>
              <button type="button" className={BTN_GHOST} onClick={() => setEditing(true)}>Editar</button>
              <button
                type="button"
                disabled={pending}
                className={BTN_GHOST}
                onClick={() => start(async () => {
                  const r = await deleteDocument(d.id!)
                  if (!r.ok) setError(r.error)
                })}
              >
                Borrar
              </button>
            </>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </td>
      </tr>
    )
  }

  return (
    <tr className="border-t border-gray-100 bg-gray-50/60 align-top">
      <td className="py-2 pr-3"><input value={d.drive_code} placeholder="C007" onChange={(e) => setD({ ...d, drive_code: e.target.value })} className={`${INPUT} font-mono`} /></td>
      <td className="py-2 pr-3"><input value={d.label} placeholder="IRPF 1er titular" onChange={(e) => setD({ ...d, label: e.target.value })} className={INPUT} /></td>
      <td className="py-2 pr-3">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={d.required} onChange={(e) => setD({ ...d, required: e.target.checked })} />Obligatorio</label>
      </td>
      <td className="py-2 pr-3">
        <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={d.ocr} onChange={(e) => setD({ ...d, ocr: e.target.checked })} />Leer datos (OCR)</label>
        {d.ocr && <input value={d.extract_field} placeholder="Dato a extraer" onChange={(e) => setD({ ...d, extract_field: e.target.value })} className={`${INPUT} mt-1 text-xs`} />}
      </td>
      <td className="py-2 text-right">
        <div className="flex flex-col items-end gap-1">
          <button type="button" disabled={pending} onClick={save} className={BTN_PRIMARY}>{pending ? '…' : 'Guardar'}</button>
          <button type="button" className={BTN_GHOST} onClick={() => { setD(doc); setEditing(false); onDone?.() }}>Cancelar</button>
          {error && <p className="max-w-[160px] text-right text-xs text-red-600">{error}</p>}
        </div>
      </td>
    </tr>
  )
}

export default function DocumentsEditor({ slug, docs, canEdit }: { slug: string; docs: RequiredDocument[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false)
  return (
    <div>
      <p className="mb-3 text-xs text-gray-500">
        n8n busca cada documento en la carpeta de Drive del cliente por su código (nombre de archivo que contiene “C007”, “F001”…).
        Si falta uno obligatorio, se informa como red flag.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400">
              <th className="pb-2 pr-3 font-medium w-[90px]">Código</th>
              <th className="pb-2 pr-3 font-medium">Documento</th>
              <th className="pb-2 pr-3 font-medium">Tipo</th>
              <th className="pb-2 pr-3 font-medium">Datos que se leen</th>
              <th className="pb-2 w-[110px]" />
            </tr>
          </thead>
          <tbody>
            {adding && (
              <Row slug={slug} canEdit={canEdit} onDone={() => setAdding(false)}
                doc={{ drive_code: '', label: '', required: true, ocr: false, extract_field: '' }} />
            )}
            {docs.map((d) => (
              <Row key={`${d.id}-${d.drive_code}-${d.label}-${d.required}-${d.ocr}`} slug={slug} canEdit={canEdit}
                doc={{ id: d.id, drive_code: d.drive_code, label: d.label, required: d.required, ocr: d.ocr, extract_field: d.extract_field ?? '' }} />
            ))}
            {!docs.length && !adding && (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">Sin documentos obligatorios</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && !adding && (
        <button type="button" className={`${BTN_SECONDARY} mt-3`} onClick={() => setAdding(true)}>+ Documento</button>
      )}
    </div>
  )
}
