// The opening is a committed text turn, not three independent realtime input
// messages. Provider completion alone does not mean an audible greeting exists.
export class OpeningTurn {
  constructor({
    send,
    event = () => {},
    exhausted,
    schedule = queueMicrotask,
  }) {
    Object.assign(this, { send, event, exhausted, schedule });
    this.attempts = 0;
    this.audible = false;
    this.userStarted = false;
    this.closed = false;
    this.retryQueued = false;
  }
  start() {
    if (this.closed || this.audible || this.userStarted) return;
    this.attempts++;
    this.event("opening_request", { attempt: this.attempts });
    try {
      this.send();
    } catch {
      this.closed = true;
      this.event("opening_delivery_failed");
      this.exhausted("delivery");
    }
  }
  audio() {
    if (!this.audible && !this.userStarted) this.event("opening_first_audio");
    this.audible = true;
  }
  input() {
    this.userStarted = true;
  }
  get awaitingAudio() {
    return (
      this.attempts > 0 && !this.audible && !this.userStarted && !this.closed
    );
  }
  complete() {
    if (this.closed || this.audible || this.userStarted || this.retryQueued)
      return;
    this.event("opening_empty", { attempt: this.attempts });
    if (this.attempts >= 2) {
      this.closed = true;
      this.exhausted("empty");
      return;
    }
    this.retryQueued = true;
    this.schedule(() => {
      this.retryQueued = false;
      if (this.closed || this.audible || this.userStarted) return;
      this.start();
    });
  }
  close() {
    this.closed = true;
  }
}
