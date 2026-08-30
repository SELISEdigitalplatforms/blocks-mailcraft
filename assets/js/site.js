/* Progressive enhancement for the docs site. Everything here is additive: with
 * JavaScript off the page is still the full document, correctly styled. */
(function () {
  'use strict';

  var body = document.querySelector('.page-body');

  // ---- primary nav: mark the page we are on ------------------------------
  var here = location.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
  Array.prototype.forEach.call(document.querySelectorAll('.nav a'), function (a) {
    var target = a.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
    if (target === here) a.setAttribute('aria-current', 'page');
  });

  // ---- colour theme ------------------------------------------------------
  // Three states, like the editor's own: unset follows the OS, and the toggle
  // pins light or dark for this browser.
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var pinned = document.documentElement.getAttribute('data-theme');
      var dark = pinned ? pinned === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      var next = dark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('mailcraft-docs-theme', next); } catch (e) { /* private mode */ }
    });
  }

  if (!body) return;

  // ---- the markdown "Contents" list is the sidebar here ------------------
  // It stays in the file so DOCS.md still navigates on GitHub and in an editor;
  // on the site it would be the same list twice.
  var contents = body.querySelector('h2[id="contents"]');
  if (contents) {
    var node = contents.nextElementSibling;
    contents.parentNode.removeChild(contents);
    while (node && node.tagName !== 'H1' && node.tagName !== 'H2') {
      var next = node.nextElementSibling;
      if (node.tagName === 'UL' || node.tagName === 'OL' || node.tagName === 'HR') node.parentNode.removeChild(node);
      node = next;
    }
  }

  // ---- wide content scrolls inside itself, never the page ----------------
  Array.prototype.forEach.call(body.querySelectorAll('table'), function (table) {
    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
  });

  // ---- copy button on every code block -----------------------------------
  Array.prototype.forEach.call(body.querySelectorAll('pre'), function (pre) {
    var host = pre.parentNode.classList.contains('highlight') ? pre.parentNode : pre;
    var wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    host.parentNode.insertBefore(wrap, host);
    wrap.appendChild(host);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.addEventListener('click', function () {
      var text = pre.innerText;
      var done = function (ok) {
        btn.textContent = ok ? 'Copied' : 'Press ⌘/Ctrl+C';
        btn.classList.toggle('done', ok);
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    });
    wrap.appendChild(btn);
  });

  // ---- heading anchors + "on this page" ----------------------------------
  var toc = document.getElementById('toc-list');
  var headings = body.querySelectorAll('h1[id], h2[id], h3[id]');
  var tracked = [];

  Array.prototype.forEach.call(headings, function (h) {
    var link = document.createElement('a');
    link.className = 'anchor';
    link.href = '#' + h.id;
    link.textContent = '#';
    link.setAttribute('aria-label', 'Link to this section');
    h.appendChild(link);

    if (!toc || h.tagName === 'H1') return;
    var item = document.createElement('a');
    item.href = '#' + h.id;
    // The anchor text is part of the heading now; take the text without it.
    item.textContent = (h.textContent || '').replace(/#$/, '').trim();
    if (h.tagName === 'H3') item.className = 'sub';
    toc.appendChild(item);
    tracked.push({ heading: h, item: item });
  });

  if (!tracked.length) {
    var aside = document.querySelector('.toc');
    if (aside) aside.style.display = 'none';
    return;
  }

  // Highlight the section the reader is in: the last heading above the
  // top-third line, so a heading scrolled just off the top still counts.
  var active = null;
  var mark = function () {
    var line = window.innerHeight * 0.32;
    var current = tracked[0];
    for (var i = 0; i < tracked.length; i++) {
      if (tracked[i].heading.getBoundingClientRect().top <= line) current = tracked[i];
    }
    if (current === active) return;
    if (active) active.item.classList.remove('active');
    current.item.classList.add('active');
    active = current;
  };

  var queued = false;
  var onScroll = function () {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; mark(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  mark();
}());
