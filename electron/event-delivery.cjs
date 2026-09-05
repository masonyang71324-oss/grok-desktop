function createEventDelivery(send, delay = 16) {
  let pending = [],
    timer;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!pending.length) return;
    const events = pending;
    pending = [];
    send({ type: 'event-batch', events });
  }
  return {
    push(event) {
      if (
        event.type === 'update' &&
        ['agent_message_chunk', 'agent_thought_chunk'].includes(event.update?.sessionUpdate)
      ) {
        pending.push(event);
        if (!timer) timer = setTimeout(flush, delay);
      } else {
        flush();
        send(event);
      }
    },
    flush,
    dispose() {
      clearTimeout(timer);
      pending = [];
    },
  };
}
module.exports = { createEventDelivery };
