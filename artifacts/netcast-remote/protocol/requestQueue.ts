export class QueueClosedError extends Error {
  constructor() {
    super('İstek kuyruğu kapatıldı.')
    this.name = 'QueueClosedError'
  }
}

export class QueueBackpressureError extends Error {
  constructor() {
    super('İstek kuyruğu dolu.')
    this.name = 'QueueBackpressureError'
  }
}

export type QueueKey = string | number

export type QueueEntryOptions = {
  key?: QueueKey
  token?: object
}

type QueueTask = (signal: AbortSignal) => Promise<void>

type QueueEntry = {
  kind: 'task' | 'move'
  task?: QueueTask
  dx?: number
  dy?: number
  key?: QueueKey
  token?: object
  sealed: boolean
  resolve: () => void
  reject: (error: unknown) => void
  settled: boolean
}

type QueueOptions = {
  maxPendingEntries?: number
  maxMoveMagnitude?: number
  moveTask?: (dx: number, dy: number, signal: AbortSignal) => Promise<void>
  onBackpressure?: () => void
  onMoveSuccess?: () => void
  onMoveError?: (error: unknown) => void
}

function clamp(value: number, limit: number) {
  return Math.max(-limit, Math.min(limit, value))
}

export class SerialRequestQueue {
  private readonly maxPendingEntries: number
  private readonly maxMoveMagnitude: number
  private readonly moveTask?: (dx: number, dy: number, signal: AbortSignal) => Promise<void>
  private readonly onBackpressure?: () => void
  private readonly onMoveSuccess?: () => void
  private readonly onMoveError?: (error: unknown) => void
  private entries: QueueEntry[] = []
  private active: { entry: QueueEntry; controller: AbortController } | null = null
  private closed = false

  constructor(options: QueueOptions = {}) {
    this.maxPendingEntries = Math.max(1, options.maxPendingEntries ?? 64)
    this.maxMoveMagnitude = Math.max(1, options.maxMoveMagnitude ?? 240)
    this.moveTask = options.moveTask
    this.onBackpressure = options.onBackpressure
    this.onMoveSuccess = options.onMoveSuccess
    this.onMoveError = options.onMoveError
  }

  get pendingCount() {
    return this.entries.length
  }

  get inFlight() {
    return this.active !== null
  }

  enqueue(task: QueueTask, options: QueueEntryOptions = {}) {
    if (this.closed) return Promise.reject(new QueueClosedError())
    if (options.key !== undefined) this.removePending((entry) => entry.key === options.key)
    if (this.entries.length >= this.maxPendingEntries) {
      this.notifyBackpressure()
      return Promise.reject(new QueueBackpressureError())
    }

    this.sealMoves()
    return new Promise<void>((resolve, reject) => {
      this.entries.push({
        kind: 'task',
        task,
        key: options.key,
        token: options.token,
        sealed: true,
        resolve,
        reject,
        settled: false,
      })
      this.drain()
    })
  }

  enqueueMove(dx: number, dy: number) {
    if (this.closed) {
      this.notifyBackpressure()
      return false
    }

    const nextX = Math.round(dx)
    const nextY = Math.round(dy)
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      this.notifyBackpressure()
      return false
    }
    if (nextX === 0 && nextY === 0) return true

    const last = this.entries[this.entries.length - 1]
    if (last?.kind === 'move' && !last.sealed) {
      const mergedX = clamp((last.dx ?? 0) + nextX, this.maxMoveMagnitude)
      const mergedY = clamp((last.dy ?? 0) + nextY, this.maxMoveMagnitude)
      const limited = mergedX !== (last.dx ?? 0) + nextX || mergedY !== (last.dy ?? 0) + nextY
      last.dx = mergedX
      last.dy = mergedY
      if (limited) this.notifyBackpressure()
      return !limited
    }

    if (this.entries.length >= this.maxPendingEntries) {
      this.notifyBackpressure()
      return false
    }

    const limitedX = Math.abs(nextX) > this.maxMoveMagnitude
    const limitedY = Math.abs(nextY) > this.maxMoveMagnitude
    const entry: QueueEntry = {
      kind: 'move',
      dx: clamp(nextX, this.maxMoveMagnitude),
      dy: clamp(nextY, this.maxMoveMagnitude),
      sealed: false,
      resolve: () => undefined,
      reject: () => undefined,
      settled: false,
    }
    entry.task = async (signal) => {
      if (!this.moveTask) return
      await this.moveTask(entry.dx ?? 0, entry.dy ?? 0, signal)
    }
    this.entries.push(entry)
    if (limitedX || limitedY) this.notifyBackpressure()
    this.drain()
    return !limitedX && !limitedY
  }

  cancel(key: QueueKey, token?: object) {
    this.removePending((entry) => entry.key === key && (token === undefined || entry.token === token))
    if (
      this.active &&
      this.active.entry.key === key &&
      (token === undefined || this.active.entry.token === token)
    ) {
      this.active.controller.abort()
    }
  }

  clear() {
    if (this.closed) return
    this.closed = true
    this.active?.controller.abort()

    const pending = this.entries
    this.entries = []
    for (const entry of pending) this.rejectEntry(entry, new QueueClosedError())
    if (this.active) this.rejectEntry(this.active.entry, new QueueClosedError())
  }

  private removePending(predicate: (entry: QueueEntry) => boolean) {
    const retained: QueueEntry[] = []
    for (const entry of this.entries) {
      if (predicate(entry)) this.resolveEntry(entry)
      else retained.push(entry)
    }
    this.entries = retained
  }

  private sealMoves() {
    for (const entry of this.entries) {
      if (entry.kind === 'move') entry.sealed = true
    }
  }

  private notifyBackpressure() {
    try {
      this.onBackpressure?.()
    } catch {
      return
    }
  }

  private rejectEntry(entry: QueueEntry, error: unknown) {
    if (entry.settled) return
    entry.settled = true
    entry.reject(error)
  }

  private resolveEntry(entry: QueueEntry) {
    if (entry.settled) return
    entry.settled = true
    entry.resolve()
  }

  private drain() {
    if (this.closed || this.active) return
    const entry = this.entries.shift()
    if (!entry) return

    const controller = new AbortController()
    this.active = { entry, controller }
    const task = entry.task

    Promise.resolve()
      .then(() => task?.(controller.signal))
      .then(
        () => {
          if (entry.kind === 'move') {
            try {
              this.onMoveSuccess?.()
            } catch {
              this.resolveEntry(entry)
              return
            }
          }
          this.resolveEntry(entry)
        },
        (error) => {
          if (entry.kind === 'move') {
            try {
              this.onMoveError?.(error)
            } catch {
              this.rejectEntry(entry, error)
              return
            }
          }
          this.rejectEntry(entry, error)
        },
      )
      .finally(() => {
        if (this.active?.entry === entry) this.active = null
        this.drain()
      })
  }
}
