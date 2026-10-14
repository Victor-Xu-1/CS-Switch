import { randomUUID } from 'node:crypto';
import { sendEvent } from './sse.mjs';

export class MessageOutput {
  constructor(response, model, stream) { Object.assign(this, { response, model, stream }); this.started = false; this.index = 0; this.content = []; }
  async start() {
    if (!this.stream || this.started) return;
    this.response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    await sendEvent(this.response, 'message_start', { message: { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: this.model, content: [], stop_reason: null, stop_sequence: null, usage: {} } });
    this.started = true;
  }
  async append(blocks) {
    this.content.push(...blocks);
    if (!this.stream) return;
    await this.start();
    for (const block of blocks) {
      const index = this.index++;
      // Complete blocks (including server receipts) are valid content starts.
      await sendEvent(this.response, 'content_block_start', { index, content_block: block });
      await sendEvent(this.response, 'content_block_stop', { index });
    }
  }
  async finish(stop_reason, usage) {
    if (this.stream) {
      await this.start();
      await sendEvent(this.response, 'message_delta', { delta: { stop_reason, stop_sequence: null }, usage });
      await sendEvent(this.response, 'message_stop', {}); this.response.end();
    } else {
      this.response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      this.response.end(JSON.stringify({ id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: this.model,
        content: this.content, stop_reason, stop_sequence: null, usage }));
    }
  }
}
