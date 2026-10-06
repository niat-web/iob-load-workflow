let override = null;

export function now() {
  return override ? new Date(override()) : new Date();
}

export function setClock(fn) {
  override = fn;
}

export function resetClock() {
  override = null;
}
