// Coalesce background reads. A mutation can supersede an old read so a late
// response can never restore stale running/stopped state in the interface.
export class LatestRequest {
  constructor(fetcher, apply, failed) { Object.assign(this, { fetcher, apply, failed }); }
  run(force = false) {
    if (this.pending && !force) return this.pending;
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    const pending = Promise.resolve().then(() => this.fetcher(controller.signal)).then(value => {
      if (this.controller === controller && !controller.signal.aborted) this.apply(value);
    }).catch(error => {
      if (this.controller !== controller || controller.signal.aborted) return;
      this.failed(error); throw error;
    }).finally(() => { if (this.pending === pending) this.pending = null; });
    this.pending = pending;
    return pending;
  }
}
