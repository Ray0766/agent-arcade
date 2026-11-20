'use strict';

// OneBot 11 uses a numeric ID for native QQ faces. Normalize the wire
// representation for readback checks without guessing its meaning.
function nativeFaceId(value) {
  if (Number.isSafeInteger(value)) value = String(value);
  return typeof value === 'string' && /^\d{1,10}$/.test(value) ? value : null;
}

module.exports = {nativeFaceId};
