/** AUTO only steps down after ten continuous slow seconds, at most once per 30 s. */
export class AutoQuality {
  private slowAt = -1;
  private changedAt = -Infinity;
  sample(now: number, ms: number, mode = 'GROUND') {
    if (ms <= 21) {
      this.slowAt = -1;
      return false;
    }
    if (this.slowAt < 0) this.slowAt = now;
    if (
      now - this.slowAt < 10000 ||
      now - this.changedAt < 30000 ||
      ['SLIDE', 'WALLRUN', 'MANTLE'].includes(mode)
    )
      return false;
    this.changedAt = now;
    this.slowAt = now;
    return true;
  }
}
