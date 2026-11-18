/** Emitter mínimo: on() devolve a função para cancelar a subscrição. */
export class Emitter {
  #h = new Map();
  on(evt, fn) {
    if (!this.#h.has(evt)) this.#h.set(evt, new Set());
    this.#h.get(evt).add(fn);
    return () => this.#h.get(evt)?.delete(fn);
  }
  emit(evt, payload) {
    for (const fn of [...(this.#h.get(evt) ?? [])]) {
      try { fn(payload); } catch (e) { console.error(`[${evt}]`, e); }
    }
  }
}
