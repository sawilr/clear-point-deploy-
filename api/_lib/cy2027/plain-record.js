// ─────────────────────────────────────────────────────────────────────────────
// CY2027 — READ A RECORD ONCE. Environment-neutral, no imports.
//
// AUDIT 2026-10-04 (red team, SPEC-22/SPEC-23). Two validators in this layer
// judged an object and then read it AGAIN to use it: a getter that answered
// 'FAILED_PHRASE' while being judged and "call me at 631-…" while being printed
// went into the log, fields held on the prototype passed a check that only
// counted own keys, and a step with one of its keys simply left out was
// "trusted". The rule for anything that claims to be a record is therefore:
// take a plain copy of its OWN DATA properties, once, and from then on look only
// at the copy. An accessor, an inherited field, a key outside the closed list
// or a missing required key means it is not that record.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A fresh plain copy of `value`'s own data properties — or null when `value` is
 * not a plain object carrying every key in `required` and nothing outside
 * `required` ∪ `optional`. Nothing is read through the prototype chain and no
 * getter is ever invoked.
 */
export function plainRecord(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const out = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return null;
    if (!required.includes(key) && !optional.includes(key)) return null;
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !('value' in d)) return null;
    out[key] = d.value;
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) return null;
  }
  return out;
}

/**
 * A fresh copy of a real array's elements — or null when `value` is not a plain
 * array of data elements (array-likes, holes, index getters and extra
 * properties are all "not a list").
 */
export function plainList(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const length = value.length;
  if (Reflect.ownKeys(value).length !== length + 1) return null;
  const out = [];
  for (let i = 0; i < length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d)) return null;
    out.push(d.value);
  }
  return out;
}

/** The own DATA property `key` of `value`, read without invoking a getter — or undefined. */
export function ownData(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && 'value' in d ? d.value : undefined;
}
