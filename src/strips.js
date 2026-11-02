'use strict';
/* Electronic flight strip bay with pointer-based drag and drop (works for finger, Pencil and mouse). */
class StripBay {
  constructor(container) {
    this.wrap = container; this.cols = [
      { id: 'del', name: 'DELIVERY' }, { id: 'gnd', name: 'GROUND' }, { id: 'twr', name: 'TOWER · RWY 24' }, { id: 'arr', name: 'ARRIVALS' },
    ];
    this.strips = [
      { cs: 'TVS7K3', type: 'B38M/M', a: 'SID VENOX5A', b: 'STAND 19 · A4521', t: 'TOBT 10:12', col: 'del', kind: 'dep' },
      { cs: 'RYR5TR', type: 'B738/M', a: 'SID BALTU5A', b: 'STAND 52 · A4522', t: 'CTOT 10:20', col: 'del', kind: 'dep' },
      { cs: 'DLH1395', type: 'A20N/M', a: 'SID VOZ4A', b: 'STAND 24 · A4510', t: 'TOBT 10:05', col: 'gnd', kind: 'dep', clr: true },
      { cs: 'WZZ2219', type: 'A21N/M', a: 'SID VOZ4A', b: 'HP 24 · A4517', t: 'CFL 5000', col: 'twr', kind: 'dep', clr: true },
      { cs: 'EZS98KH', type: 'A320/M', a: 'ILS 24', b: 'STAND 7 · A2213', t: 'ETA 10:03', col: 'arr', kind: 'arr' },
      { cs: 'UAE139', type: 'B77W/H', a: 'ILS 24', b: 'STAND 5 · A6612', t: 'ETA 10:09', col: 'arr', kind: 'arr' },
    ];
    this.render(); this.drag = null; this.seen = new Set();
  }
  render() {
    this.wrap.innerHTML = '';
    const bay = el('div', { class: 'bay' }); this.wrap.append(bay); this.lists = {};
    for (const c of this.cols) {
      const list = el('div', { class: 'bay-list', 'data-col': c.id });
      bay.append(el('div', { class: 'bay-col' }, el('h4', { text: c.name }), list)); this.lists[c.id] = list;
    }
    for (const s of this.strips) this.lists[s.col].append(this.stripEl(s));
  }
  stripEl(s) {
    const flag = s.kind === 'arr' ? (s.clr ? 'LAND CLR' : 'APPROACH') : (s.clr ? 'CLR' : 'NO CLR');
    const e = el('div', { class: 'strip' + (s.kind === 'arr' ? ' arr' : '') + (s.clr ? ' clr' : ''), tabindex: '0', 'aria-label': `Strip ${s.cs}, ${flag}` },
      el('div', { class: 'bar' }),
      el('div', { class: 'main' }, el('div', { class: 'row1' }, el('span', { class: 'cs', text: s.cs }), el('span', { class: 'flag', text: flag })),
        el('div', { class: 'sub', text: `${s.type} · ${s.a}` }), el('div', { class: 'sub', text: s.b }), el('div', { class: 'sub', text: s.t })));
    e._s = s;
    e.addEventListener('pointerdown', ev => this.down(ev, e));
    e.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.toggle(e); } });
    return e;
  }
  toggle(e) { e._s.clr = !e._s.clr; const ne = this.stripEl(e._s); e.replaceWith(ne); App.feature('stripTap'); }
  down(ev, e) {
    ev.preventDefault(); App.inputSeen(ev, 'down');
    try { e.setPointerCapture(ev.pointerId); } catch (_) {}
    const r = e.getBoundingClientRect();
    this.drag = { e, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, ox: ev.clientX - r.left, oy: ev.clientY - r.top, moved: false, type: ev.pointerType, t0: performance.now() };
    const mv = (m) => this.move(m), up = (u) => { e.removeEventListener('pointermove', mv); e.removeEventListener('pointerup', up); e.removeEventListener('pointercancel', up); this.up(u); };
    e.addEventListener('pointermove', mv); e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
  }
  move(ev) {
    const d = this.drag; if (!d || ev.pointerId !== d.id) return;
    if (!d.moved && Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 8) {
      d.moved = true; d.ghost = d.e.cloneNode(true); d.ghost.classList.add('strip-ghost'); d.ghost.style.width = d.e.getBoundingClientRect().width + 'px'; document.body.append(d.ghost);
      d.ph = el('div', { class: 'strip-ph' }); d.e.after(d.ph); d.e.classList.add('dragging');
    }
    if (!d.moved) return;
    d.ghost.style.left = (ev.clientX - d.ox) + 'px'; d.ghost.style.top = (ev.clientY - d.oy) + 'px';
    const list = this.listAt(ev.clientX, ev.clientY);
    if (list) {
      const kids = [...list.children].filter(k => k !== d.e && k !== d.ph);
      let before = null; for (const k of kids) { const r = k.getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { before = k; break; } }
      if (before) list.insertBefore(d.ph, before); else list.append(d.ph);
    }
  }
  listAt(x, y) { for (const l of Object.values(this.lists)) { const r = l.parentElement.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return l; } return null; }
  up(ev) {
    const d = this.drag; this.drag = null; if (!d) return;
    if (!d.moved) { if (performance.now() - d.t0 < 600) this.toggle(d.e); return; }
    d.ghost.remove(); d.e.classList.remove('dragging');
    const from = d.e._s.col; const list = d.ph.parentElement; d.ph.replaceWith(d.e);
    d.e._s.col = list.getAttribute('data-col');
    const kind = d.e._s.col === from ? 'stripReorder' : 'stripMove';
    App.feature(kind, d.type);
  }
}
