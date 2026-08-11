export class TaskQueue {
  constructor({ concurrency = 1, onChange = () => {} } = {}) {
    this.concurrency = concurrency;
    this.onChange = onChange;
    this.items = [];
    this.running = 0;
  }

  add(task) {
    if (this.items.some(x => x.hash === task.hash && !['failed', 'cancelled'].includes(x.status))) return null;
    const item = { ...task, status: 'queued', createdAt: Date.now() };
    this.items.push(item);
    this.onChange(this.items);
    this.#pump();
    return item;
  }

  cancel(id) {
    const item = this.items.find(x => x.id === id && x.status === 'queued');
    if (item) { item.status = 'cancelled'; this.onChange(this.items); }
  }

  async #pump() {
    while (this.running < this.concurrency) {
      const item = this.items.find(x => x.status === 'queued');
      if (!item) return;
      this.running++;
      item.status = 'generating'; this.onChange(this.items);
      try { item.result = await item.run(item); item.status = 'completed'; }
      catch (error) { item.error = String(error?.message || error); item.status = 'failed'; }
      finally { this.running--; this.onChange(this.items); }
    }
  }
}
