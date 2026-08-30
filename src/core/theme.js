/**
 * The document's page-level model. `bg` paints the full-width area the email
 * sits on (what a mail client shows around the content column), `contentBg`
 * paints the content column itself, and `padY`/`padX`/`radius` shape the gap
 * between the two -- the band that is otherwise an unstyleable strip around
 * every template.
 *
 * They default to 0 rather than to the 24px/12px band the exporter used to
 * hard-code: that band was in every sent template with no way to reach it,
 * which is the strip around the content column that looked like a rendering
 * fault. Now it is off unless a document asks for it. Both background keys
 * accept the literal `transparent` (and any rgba()/#rrggbbaa value) as well
 * as a hex colour.
 */
export const THEME = () => ({ bg: '#eef2f7', contentBg: '#ffffff', width: 620, padY: 0, padX: 0, radius: 0, font: '"Helvetica Neue", Helvetica, Arial, sans-serif', text: '#172033', link: '#0065b3' });
