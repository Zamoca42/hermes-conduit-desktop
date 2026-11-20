/**
 * The connection a Gemini Live call hands off to after a GoAway, while the current one keeps serving.
 * As on the phone (GeminiLiveSession's `isHandingOff`, `handoffSocket` and `dropHandoff()`): one handoff at a time,
 * claimed before its connection opens, a previous one closed before it's replaced, and closed whenever the call
 * ends or gives it up, so no connection (and its single-use credential) outlives the call.
 */
export class LiveHandoff {
  /** The handoff's connection, once open and until it takes over or closes. */
  id: string | null = null
  private handingOff = false
  private generation = 0

  constructor(private readonly close: (id: string) => void) {}

  /** True while a handoff is under way, from the GoAway until it takes over or is dropped, its retries included. */
  get active(): boolean {
    return this.handingOff
  }

  /** Starts a handoff, unless one is under way: a second GoAway while the first one's connection opens starts none. */
  claim(): boolean {
    if (this.handingOff) return false
    this.handingOff = true
    return true
  }

  /** Taken before a handoff's connection is opened, and handed back to `accept` once it has. */
  token(): number {
    return this.generation
  }

  /**
   * A handoff connection that opened: kept, unless the handoff was dropped while it opened, when it's closed.
   * A previous connection still in setup is closed before it's replaced.
   */
  accept(id: string, token: number): boolean {
    if (!this.handingOff || token !== this.generation) {
      this.close(id)
      return false
    }
    if (this.id && this.id !== id) this.close(this.id)
    this.id = id
    return true
  }

  /** The handoff is set up: its connection becomes the call's, and the handoff is over. */
  take(): string | null {
    const id = this.id
    this.id = null
    this.handingOff = false
    this.generation += 1
    return id
  }

  /** The handoff's connection closed on its own; the handoff goes on if it retries. */
  closed(): void {
    this.id = null
  }

  /** Gives the handoff up: its connection, open or still in setup, is closed, and one still opening is closed once it opens. */
  drop(): void {
    if (this.id) this.close(this.id)
    this.id = null
    this.handingOff = false
    this.generation += 1
  }
}
