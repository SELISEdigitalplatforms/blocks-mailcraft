export const DEFAULT_VARS = 'first_name\nlast_name\nemail\ncompany\ncity\norder_id\nplan\ndiscount\nunsubscribe_url';
export const TOKEN = (t) => '{' + '{ ' + t + ' }' + '}';

/** Variables are supplied by the host application -- the editor only ever shows the tokens, never a substituted value. */
export function vars(raw) {
  const list = Array.isArray(raw) ? raw : String(raw == null ? DEFAULT_VARS : raw).split(/[\n,]/);
  return list.map((v) => String(v).trim().replace(/^\{\{\s*|\s*\}\}$/g, '')).filter(Boolean);
}

/** Which prop field a merge tag lands in when inserted from the Data tab, keyed by the selected block's type. */
export const INSERT_KEYS = { text: 'html', heading: 'text', button: 'label', html: 'code', codeblock: 'code', quote: 'text', list: 'items', table: 'data' };
