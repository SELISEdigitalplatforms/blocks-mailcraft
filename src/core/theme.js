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
 *
 * `contentBgImage` paints a photo or pattern behind the content column. It
 * lives at content level rather than page level on purpose: the content
 * column is already a <table>, which is the one element every client paints a
 * background on, whereas a page background has to ride <body> -- and Gmail
 * discards the body element wholesale, so a page-level image is simply absent
 * there. Same fit/position/repeat vocabulary as a row's background image.
 */
/*
 * `preheader` is the inbox preview line -- the text a client shows next to the
 * subject. Absent, every client scrapes the first visible copy instead, which
 * is usually "View in browser" or a logo's alt text. `dir` is the document's
 * own reading direction, set here and nowhere else: the editor chrome follows
 * the UI locale, but a German-speaking author building an Arabic mailing (or
 * the reverse) must not have the email flip with the menus.
 */
/*
 * `bgImage` paints the full-width page behind everything. It rides the
 * full-width wrapper <table> and <body> both: Gmail discards the body element,
 * so the table is what makes it render there. Same fit/position/repeat
 * vocabulary as a row and the content area.
 */
/*
 * `fontLinks` carries the webfont stylesheets a source document declared in
 * <head> (`<link rel="stylesheet" href="https://fonts.googleapis.com/...">`).
 * Neither half of the pipeline used to handle <link> at all, so importing a
 * template built on Poppins silently dropped the font and every glyph in the
 * email changed -- the single most visible loss an import could produce, and
 * the hardest to attribute, because the CSS font stack still named the face.
 *
 * Only font-provider hosts are kept (FONT_LINK_HOSTS, below):
 * a stylesheet <link> is a request the reading client makes on the recipient's
 * behalf, so an arbitrary URL here is a tracking pixel with better manners.
 */
export const FONT_LINK_HOSTS = /^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net)\//i;

/*
 * `css` holds the rules an imported document declared that cannot become
 * inline styles -- `@media`, `@font-face`, `:hover`. It is document-level, not
 * a block: a stylesheet applies to the whole email, and giving it a row of its
 * own would change the row structure of every template that has one.
 * MailCraft's own generated rules are pruned out before they land here, or a
 * save would append a fresh copy of them on every cycle.
 */
export const THEME = () => ({ preheader: '', dir: '', fontLinks: [], css: '', bg: '#eef2f7', bgImage: '', bgSize: 'cover', bgPos: 'center', bgRepeat: 'no-repeat', contentBg: '#ffffff', contentBgImage: '', contentBgSize: 'cover', contentBgPos: 'center', contentBgRepeat: 'no-repeat', width: 620, padY: 0, padX: 0, radius: 0, borderW: 0, borderStyle: 'solid', borderColor: '#e2e2e5', shadow: '', font: '"Helvetica Neue", Helvetica, Arial, sans-serif', text: '#172033', link: '#0065b3' });
