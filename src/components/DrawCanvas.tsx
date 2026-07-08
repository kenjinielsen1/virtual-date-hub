import { useEffect, useRef, useState } from 'react'
import { useRoomChannel } from '../lib/RoomChannel'
import { supabase } from '../lib/supabase'
import type { Session } from '../lib/session'

// Fixed internal resolution so both canvases share a coordinate space
// regardless of how big each person's screen renders it.
const W = 900
const H = 560
const FLUSH_MS = 40 // batch stroke points instead of one event per move

interface Point {
  x: number
  y: number
}
interface StrokeBatch {
  strokeId: string
  color: string
  size: number
  eraser: boolean
  points: Point[]
  end: boolean
}

const COLORS = ['#0f172a', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899']

export function DrawCanvas({
  session,
  readOnly = false,
  clearKey,
}: {
  session: Session
  // Guessers in Pictionary watch but can't draw, and the toolbar is hidden.
  readOnly?: boolean
  // When this changes, the local canvas clears (used to reset between rounds).
  clearKey?: string | number
}) {
  const { broadcast, on } = useRoomChannel()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  const [color, setColor] = useState('#0f172a')
  const [size, setSize] = useState(4)
  const [eraser, setEraser] = useState(false)

  // Refs used inside pointer/interval handlers (avoid stale closures).
  const colorRef = useRef(color)
  colorRef.current = color
  const sizeRef = useRef(size)
  sizeRef.current = size
  const eraserRef = useRef(eraser)
  eraserRef.current = eraser

  const drawing = useRef(false)
  const strokeId = useRef<string | null>(null)
  const lastLocal = useRef<Point | null>(null)
  const pending = useRef<Point[]>([]) // points awaiting broadcast
  const remoteLast = useRef<Map<string, Point>>(new Map())

  function applyStyle(
    ctx: CanvasRenderingContext2D,
    c: string,
    s: number,
    isEraser: boolean,
  ) {
    ctx.lineWidth = s
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = isEraser ? '#ffffff' : c
    ctx.fillStyle = isEraser ? '#ffffff' : c
  }

  function dot(ctx: CanvasRenderingContext2D, p: Point, s: number) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  function line(ctx: CanvasRenderingContext2D, a: Point, b: Point) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }

  function clearCanvas() {
    const ctx = ctxRef.current
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)
  }

  // Set up context + white background once.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctxRef.current = ctx
    clearCanvas()
  }, [])

  // Clear the local canvas whenever the round (clearKey) changes.
  const firstClear = useRef(true)
  useEffect(() => {
    if (firstClear.current) {
      firstClear.current = false
      return
    }
    clearCanvas()
    remoteLast.current.clear()
  }, [clearKey])

  // Flush buffered local points on a timer so we don't flood the channel.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!strokeId.current || pending.current.length === 0) return
      const batch: StrokeBatch = {
        strokeId: strokeId.current,
        color: colorRef.current,
        size: sizeRef.current,
        eraser: eraserRef.current,
        points: pending.current,
        end: false,
      }
      pending.current = []
      broadcast('draw:stroke', batch)
    }, FLUSH_MS)
    return () => window.clearInterval(id)
  }, [broadcast])

  // Receive remote strokes + clears.
  useEffect(() => {
    const offStroke = on('draw:stroke', (p) => {
      const b = p as StrokeBatch
      const ctx = ctxRef.current
      if (!ctx || b.points.length === 0) return
      applyStyle(ctx, b.color, b.size, b.eraser)
      let last = remoteLast.current.get(b.strokeId)
      let i = 0
      if (!last) {
        dot(ctx, b.points[0], b.size)
        last = b.points[0]
        i = 1
      }
      for (; i < b.points.length; i++) {
        line(ctx, last, b.points[i])
        last = b.points[i]
      }
      if (b.end) remoteLast.current.delete(b.strokeId)
      else remoteLast.current.set(b.strokeId, last)
    })
    const offClear = on('draw:clear', () => {
      clearCanvas()
      remoteLast.current.clear()
    })
    return () => {
      offStroke()
      offClear()
    }
  }, [on])

  function posFromEvent(e: React.PointerEvent): Point {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (readOnly) return
    const ctx = ctxRef.current
    if (!ctx) return
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drawing.current = true
    strokeId.current = crypto.randomUUID()
    const p = posFromEvent(e)
    lastLocal.current = p
    applyStyle(ctx, color, size, eraser)
    dot(ctx, p, size)
    pending.current = [p]
  }

  function onPointerMove(e: React.PointerEvent) {
    if (readOnly || !drawing.current) return
    const ctx = ctxRef.current
    if (!ctx || !lastLocal.current) return
    const p = posFromEvent(e)
    applyStyle(ctx, color, size, eraser)
    line(ctx, lastLocal.current, p)
    lastLocal.current = p
    pending.current.push(p)
  }

  function endStroke() {
    if (!drawing.current) return
    drawing.current = false
    // Final flush marked as the end of this stroke.
    if (strokeId.current) {
      broadcast('draw:stroke', {
        strokeId: strokeId.current,
        color: colorRef.current,
        size: sizeRef.current,
        eraser: eraserRef.current,
        points: pending.current,
        end: true,
      } satisfies StrokeBatch)
    }
    pending.current = []
    strokeId.current = null
    lastLocal.current = null
  }

  function handleClear() {
    clearCanvas()
    broadcast('draw:clear', {})
  }

  function saveImage() {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `our-drawing-${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  const [savingMem, setSavingMem] = useState(false)
  const [memMsg, setMemMsg] = useState('')

  // Canvas → PNG blob → Storage → memories row (URL only, never base64).
  async function saveToMemories() {
    const canvas = canvasRef.current
    if (!canvas || savingMem) return
    const title = window.prompt('Give this drawing a title (optional):', '')
    if (title === null) return // cancelled
    setSavingMem(true)
    setMemMsg('')
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      )
      if (!blob) throw new Error('could not export the canvas')
      const path = `${session.roomCode}/${crypto.randomUUID()}.png`
      const { error: upErr } = await supabase.storage
        .from('memories')
        .upload(path, blob, { contentType: 'image/png' })
      if (upErr) throw upErr
      const image_url = supabase.storage.from('memories').getPublicUrl(path)
        .data.publicUrl
      const { data: row, error: insErr } = await supabase
        .from('memories')
        .insert({
          room_id: session.roomCode,
          kind: 'drawing',
          title: title.trim() || null,
          image_url,
          created_by: session.identity,
        })
        .select()
        .single()
      if (insErr) throw insErr
      broadcast('memory:new', row) // live-update the partner's feed
      setMemMsg('Saved to Memories ♡')
    } catch (e) {
      setMemMsg(
        e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save.",
      )
    } finally {
      setSavingMem(false)
      window.setTimeout(() => setMemMsg(''), 4000)
    }
  }

  return (
    <div className="rounded-2xl bg-paper ring-1 ring-ink/10 shadow-sm p-6 flex flex-col gap-4">
      {!readOnly && (
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-stone-800 mr-2">🎨 Draw together</h2>

        {/* Colors */}
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setColor(c)
                setEraser(false)
              }}
              className={`w-6 h-6 rounded-full ring-2 ${
                color === c && !eraser ? 'ring-stone-800' : 'ring-transparent'
              }`}
              style={{ backgroundColor: c }}
              aria-label={`color ${c}`}
            />
          ))}
        </div>

        {/* Brush size */}
        <label className="flex items-center gap-2 text-sm text-stone-500">
          Size
          <input
            type="range"
            min={1}
            max={40}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
        </label>

        <button
          type="button"
          onClick={() => setEraser((v) => !v)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            eraser ? 'bg-stone-800 text-white' : 'bg-stone-100 text-stone-600'
          }`}
        >
          Eraser
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-lg px-3 py-1.5 text-sm font-medium bg-red-100 text-red-600 hover:bg-red-200"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={saveToMemories}
          disabled={savingMem}
          className="rounded-lg px-3 py-1.5 text-sm font-medium bg-seal-500 text-white hover:bg-seal-600 disabled:opacity-50"
        >
          {savingMem ? 'Saving…' : 'Save to Memories ♡'}
        </button>
        <button
          type="button"
          onClick={saveImage}
          className="rounded-lg px-3 py-1.5 text-sm font-medium bg-seal-100 text-seal-700 hover:bg-seal-200"
        >
          Download
        </button>
        {memMsg && (
          <span
            className={`text-xs ${memMsg.startsWith('Saved') ? 'text-green-600' : 'text-red-500'}`}
          >
            {memMsg}
          </span>
        )}
      </div>
      )}

      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        className={`w-full rounded-2xl border border-stone-200 bg-white touch-none ${
          readOnly ? 'cursor-default' : 'cursor-crosshair'
        }`}
        style={{ aspectRatio: `${W} / ${H}` }}
      />
      {!readOnly && (
        <p className="text-xs text-stone-400">
          Draw with your mouse or finger — strokes sync live. “Save image”
          downloads a PNG of the current canvas.
        </p>
      )}
    </div>
  )
}
