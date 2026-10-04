'use strict';
const { isDeepStrictEqual } = require('node:util');

function sameFieldsExcept(left, right, excluded) {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && (key === excluded || isDeepStrictEqual(left[key], right[key])),
    )
  );
}

// The array owns its entries. Never extend an emitted delta or a caller's object.
// User chunks stay separate: adjacent prompts can represent different turns.
function appendHistoryUpdate(updates, update) {
  const previous = updates.at(-1);
  if (
    previous &&
    ['agent_message_chunk', 'agent_thought_chunk'].includes(update.sessionUpdate) &&
    previous.sessionUpdate === update.sessionUpdate &&
    previous.content?.type === 'text' &&
    update.content?.type === 'text' &&
    typeof previous.content.text === 'string' &&
    typeof update.content.text === 'string' &&
    sameFieldsExcept(previous, update, 'content') &&
    sameFieldsExcept(previous.content, update.content, 'text')
  ) {
    previous.content.text += update.content.text;
  } else {
    updates.push(structuredClone(update));
  }
  return updates.length - 1;
}

module.exports = { appendHistoryUpdate };
