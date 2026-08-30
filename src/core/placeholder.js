/** Data-URI placeholder image generator, ported verbatim from the original. */
function enc(s) {
  return encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export function PH(label, w, ht) {
  return 'data:image/svg+xml;utf8,' + enc(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + ht + '">' +
    '<defs><pattern id="s" width="9" height="9" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
    '<rect width="9" height="9" fill="#ececed"/><line x1="0" y1="0" x2="0" y2="9" stroke="#cfd3d8" stroke-width="3"/></pattern></defs>' +
    '<rect width="100%" height="100%" fill="url(#s)"/>' +
    '<rect x="0.5" y="0.5" width="' + (w - 1) + '" height="' + (ht - 1) + '" fill="none" stroke="#9aa2ab"/>' +
    '<text x="50%" y="50%" dy="4" text-anchor="middle" font-family="ui-monospace,monospace" font-size="' + Math.max(11, Math.round(w / 40)) + '" fill="#5b6672">' + label + '</text></svg>',
  );
}
