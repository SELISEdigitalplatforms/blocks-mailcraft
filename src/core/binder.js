/** Ported verbatim from the original `binder(getProps, set)` and `decorate(list)`. Pure field-descriptor logic, no DOM. */
export function binder(getProps, set, core) {
  return {
    head: (label) => ({ kind: 'head', label }),
    // `suggestions` (optional array of strings) renders as a datalist on the
    // input: the user picks one of the host's values or types any other.
    text: (label, key, ph, suggestions) => ({ kind: 'text', label, value: getProps()[key] ?? '', placeholder: ph || '', suggestions: Array.isArray(suggestions) && suggestions.length ? suggestions : null, onChange: (v) => set(key, v) }),
    area: (label, key, ph) => ({ kind: 'area', label, value: getProps()[key] ?? '', placeholder: ph || '', onChange: (v) => set(key, v) }),
    // Live typing only commits parseable numbers -- `Number('')` is 0, and
    // committing that the instant a field was cleared to retype (e.g. the
    // theme's content width collapsing to 0px mid-edit) was one of the
    // "inputs behave weird" symptoms. Blur settles the final value, clamped.
    num: (label, key, min, max) => ({
      kind: 'num', label, value: getProps()[key] ?? 0, min, max,
      onChange: (v) => { const n = parseFloat(v); if (Number.isFinite(n)) set(key, n); },
      onBlur: (v) => {
        if (core && core.rendering) return;
        const n = parseFloat(v);
        set(key, Math.min(max, Math.max(min, Number.isFinite(n) ? n : (getProps()[key] ?? min))));
      },
    }),
    color: (label, key) => ({ kind: 'color', label, value: getProps()[key] ?? '', swatch: /^#/.test(getProps()[key] || '') ? getProps()[key] : '#ffffff', onChange: (v) => set(key, v) }),
    // A native range slider commits on every drag tick -- dozens a second --
    // and each one used to trigger a full doc clone + re-render (see
    // `commit`), which is what made dragging feel like stutter instead of a
    // smooth slide. A stepper sidesteps that class of bug entirely: +/- is a
    // single discrete commit per click, and typing a value only commits once
    // you're done (on blur), not per keystroke.
    range: (label, key, min, max, step, unit) => {
      const cur = getProps()[key] ?? min;
      const s = step || 1;
      const decimals = (String(s).split('.')[1] || '').length;
      const clamp = (v) => Math.min(max, Math.max(min, v));
      const round = (v) => Number(v.toFixed(decimals));
      const commit = (v) => set(key, round(clamp(v)));
      return {
        kind: 'range', label, value: cur, min, max, step: s, unit: unit || '', display: cur + (unit || ''),
        onDec: () => commit(cur - s),
        onInc: () => commit(cur + s),
        // Live-typed digits aren't clamped (typing "1" toward "12" with a min
        // of 10 would otherwise get snapped back to 10 mid-keystroke, making
        // the second digit impossible to enter) -- only guarded against a
        // non-numeric intermediate state (e.g. a bare "-").
        onInput: (v) => { const n = parseFloat(v); if (!Number.isNaN(n)) set(key, n); },
        // A render tears down and rebuilds the whole panel subtree (no
        // diffing); removing this still-focused input as part of that forces
        // a synchronous, spurious `blur` before the rebuilt replacement can
        // be refocused. Committing on that blur re-renders again, which
        // tears down and blurs again -- an infinite loop. `core.rendering`
        // (set for the render()'s duration) tells a real blur apart from
        // that artifact -- same guard as canvas.js's RTE `onBlur`.
        onBlur: (v) => { if (core && core.rendering) return; const n = parseFloat(v); commit(Number.isNaN(n) ? cur : n); },
      };
    },
    // A real drag slider, for coarse visual sizing (content width). The
    // per-tick commit problem that ruled sliders out for ordinary fields
    // (see `range` above) is sidestepped by contract: the renderer moves the
    // value bubble live during the drag but only calls `onCommit` on release
    // ('change'), so a whole drag costs one re-render.
    slider: (label, key, min, max, step, unit) => ({
      kind: 'slider', label, value: getProps()[key] ?? min, min, max, step: step || 1, unit: unit || '',
      onCommit: (v) => { const n = parseFloat(v); if (Number.isFinite(n)) set(key, Math.min(max, Math.max(min, n))); },
    }),
    sel: (label, key, opts) => {
      const options = opts.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
      const current = getProps()[key];
      return {
        kind: 'select', label,
        // New controls must not render as an unexplained blank on documents
        // saved before that property existed. The renderer already uses the
        // first option as its semantic fallback; show that same choice here.
        value: current == null ? (options[0]?.value ?? '') : current,
        options,
        onChange: (v) => set(key, v),
      };
    },
    seg: (label, key, opts) => ({
      kind: 'seg', label, options: opts.map((o) => {
        const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label;
        const on = getProps()[key] === v;
        return { label: l, bg: on ? 'var(--ed-accent)' : 'transparent', fg: on ? 'var(--ed-accent-ink)' : 'var(--ed-muted)', onClick: () => set(key, v) };
      }),
    }),
    tog: (label, key, defaultOn) => {
      const raw = getProps()[key];
      const on = raw === undefined ? !!defaultOn : !!raw;
      return { kind: 'toggle', label, on, onChange: () => set(key, !on) };
    },
    btn: (label, onClick) => ({ kind: 'btn', label, onClick }),
  };
}

/**
 * A grid of linked steppers for props that come in sides/corners ("Space
 * inside" top/bottom/left/right). `toggle` ({on, onChange}), when present,
 * renders as the header's "More options" switch that swaps the linked pair
 * for per-side fields; `label: null` drops the header row entirely (the
 * section head above already names the group).
 */
export function group(label, items, toggle) {
  return { kind: 'rangeGroup', label, items, toggle: toggle || null };
}

export function decorate(list) {
  return list.filter(Boolean).map((f, i) => {
    const d = Object.assign({}, f, {
      key: i,
      isHead: f.kind === 'head', isArea: f.kind === 'area', isBtn: f.kind === 'btn', isSeg: f.kind === 'seg',
      isRange: f.kind === 'range', isToggle: f.kind === 'toggle', isSocial: f.kind === 'social', isTableGrid: f.kind === 'tablegrid', isRichLinks: f.kind === 'richLinks',
      isRangeGroup: f.kind === 'rangeGroup', isSlider: f.kind === 'slider',
      isRow: ['text', 'num', 'color', 'select'].indexOf(f.kind) > -1,
      isField: ['text', 'num', 'color', 'select'].indexOf(f.kind) > -1,
      isText: f.kind === 'text', isNum: f.kind === 'num', isColor: f.kind === 'color', isSelect: f.kind === 'select',
    });
    // Group items are ranges rendered as grid cells: they need decorated
    // flags and focus keys of their own, namespaced under the group's index
    // so they stay unique against the flat list.
    if (d.isRangeGroup) d.items = f.items.map((it, j) => Object.assign({}, it, { key: i + 'g' + j, isRange: true }));
    return d;
  });
}
