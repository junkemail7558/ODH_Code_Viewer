// ODH Code Viewer — Main Application
(function () {
  'use strict';

  // ── State ──
  let currentRule = null;
  let fuse = null;
  let searchIndex = [];
  let activeSection = null;
  let observer = null;

  // ── DOM refs ──
  const $ = (s) => document.querySelector(s);
  const ruleSelector = $('#ruleSelector');
  const sourceLink = $('#sourceLink');
  const themeToggle = $('#themeToggle');
  const searchInput = $('#searchInput');
  const searchClear = $('#searchClear');
  const searchResults = $('#searchResults');
  const breadcrumb = $('#breadcrumb');
  const toc = $('#toc');
  const ruleHeader = $('#ruleHeader');
  const ruleBody = $('#ruleBody');
  const scrollTopBtn = $('#scrollTop');
  const sidebar = $('#sidebar');
  const sidebarOverlay = $('#sidebarOverlay');
  const hamburger = $('#hamburger');

  // ── Init ──
  function init() {
    initTheme();
    populateRuleSelector();
    loadRule(RULE_REGISTRY[0].id);
    bindEvents();
  }

  // ── Theme ──
  function initTheme() {
    const saved = localStorage.getItem('odh-theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', 'dark');
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('odh-theme', next);
  }

  // ── Rule Selector ──
  function populateRuleSelector() {
    RULE_REGISTRY.forEach((r) => {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = `Rule ${r.id} — ${r.title}`;
      ruleSelector.appendChild(opt);
    });
  }

  function loadRule(id) {
    const entry = RULE_REGISTRY.find((r) => r.id === id);
    if (!entry) return;
    currentRule = entry.getData();
    sourceLink.href = currentRule.sourceUrl;
    renderHeader();
    renderStalenessBanner();
    renderContent();
    buildTOC();
    buildSearchIndex();
    initScrollSpy();
    handleHash();
  }

  // ── Header ──
  function renderHeader() {
    ruleHeader.innerHTML = `
      <h2>Rule ${currentRule.id}</h2>
      <div class="rule-subtitle">${currentRule.title}</div>
      <div class="rule-meta">
        <span>Effective: ${formatDate(currentRule.effectiveDate)}</span>
        <span>Five-year review: ${formatDate(currentRule.fiveYearReview)}</span>
        <span>Authorized by: ORC &sect;${currentRule.authorizedBy}</span>
      </div>`;
  }

  // ── Staleness Banner ──
  function renderStalenessBanner() {
    const existing = document.getElementById('stale-banner');
    if (existing) existing.remove();

    const effective = new Date(currentRule.effectiveDate + 'T00:00:00');
    const ageMs = Date.now() - effective.getTime();
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    if (ageMs < oneYearMs) return;

    // Use sessionStorage so it dismisses for the tab session but reappears next time
    const dismissKey = `stale-dismissed-${currentRule.id}-${currentRule.effectiveDate}`;
    if (sessionStorage.getItem(dismissKey)) return;

    const years = Math.floor(ageMs / oneYearMs);
    const banner = document.createElement('div');
    banner.id = 'stale-banner';
    banner.className = 'stale-banner';
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span>The stored rule data was last effective <strong>${formatDate(currentRule.effectiveDate)}</strong> — over ${years === 1 ? 'a year' : years + ' years'} ago. Run <code>node check-updates.js</code> to verify it is still current.</span>
      <button class="stale-dismiss" aria-label="Dismiss">&#x2715;</button>`;

    banner.querySelector('.stale-dismiss').addEventListener('click', () => {
      sessionStorage.setItem(dismissKey, '1');
      banner.remove();
    });

    ruleHeader.after(banner);
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  // ── Content Renderer ──
  function renderContent() {
    ruleBody.innerHTML = '';
    if (currentRule.preamble) {
      const p = document.createElement('p');
      p.className = 'section-text';
      p.style.marginBottom = '16px';
      p.textContent = currentRule.preamble;
      ruleBody.appendChild(p);
    }
    currentRule.sections.forEach((s) => ruleBody.appendChild(renderSection(s, 0)));
  }

  function renderSection(node, depth) {
    const div = document.createElement('div');
    div.className = `section section-depth-${Math.min(depth, 4)}`;
    div.id = node.id;
    div.dataset.sectionId = node.id;

    // Heading row
    const heading = document.createElement('div');
    heading.className = 'section-heading';

    const label = document.createElement('span');
    label.className = 'section-label';
    label.textContent = node.label;
    heading.appendChild(label);

    if (node.title) {
      const title = document.createElement('span');
      title.className = 'section-title';
      title.textContent = node.title + (node.text || node.children.length ? '.' : '');
      heading.appendChild(title);
    }

    // Copy citation button (e.g. "OAC 3701-31-04(E)(4)(e)")
    const copyCiteBtn = document.createElement('button');
    copyCiteBtn.className = 'copy-btn';
    copyCiteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyCiteBtn.title = 'Copy citation (e.g. OAC 3701-31-04(E)(4))';
    copyCiteBtn.dataset.copyType = 'cite';
    copyCiteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyCitation(node, copyCiteBtn);
    });
    heading.appendChild(copyCiteBtn);

    // Copy citation + text button
    const copyCiteTextBtn = document.createElement('button');
    copyCiteTextBtn.className = 'copy-btn';
    copyCiteTextBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="5" x2="19" y2="5"/><line x1="13" y1="9" x2="19" y2="9"/><line x1="13" y1="13" x2="17" y2="13"/></svg>';
    copyCiteTextBtn.title = 'Copy citation + text';
    copyCiteTextBtn.dataset.copyType = 'cite-text';
    copyCiteTextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyCitationWithText(node, copyCiteTextBtn);
    });
    heading.appendChild(copyCiteTextBtn);

    div.appendChild(heading);

    // Text
    if (node.text) {
      const textEl = document.createElement('div');
      textEl.className = 'section-text';
      textEl.innerHTML = formatText(node.text);
      div.appendChild(textEl);
    }

    // Blockquote
    if (node.blockquote) {
      const bq = document.createElement('blockquote');
      bq.className = 'rule-blockquote';
      bq.innerHTML = node.blockquote.replace(/\n/g, '<br>');
      div.appendChild(bq);
    }

    // Table
    if (node.table) {
      div.appendChild(renderTable(node.table));
    }

    // Children
    node.children.forEach((child) => div.appendChild(renderSection(child, depth + 1)));

    return div;
  }

  function formatText(text) {
    // Linkify rule cross-references
    return text
      .replace(/\n\n/g, '</p><p class="section-text">')
      .replace(/rule\s+(3701-31-[\d.]+)/gi, (m, ruleNum) =>
        `<a class="cross-ref" href="https://codes.ohio.gov/ohio-administrative-code/rule-${ruleNum}" target="_blank" rel="noopener">rule ${ruleNum}</a>`)
      .replace(/rule\s+(3745-[\d-]+)/gi, (m, ruleNum) =>
        `<a class="cross-ref" href="https://codes.ohio.gov/ohio-administrative-code/rule-${ruleNum}" target="_blank" rel="noopener">rule ${ruleNum}</a>`)
      .replace(/(\d+\.?\d*)\s*(ppm|parts per million|degrees Fahrenheit|millivolts|feet|inches|seconds|minutes|hours|days|years)/gi,
        (m, num, unit) => `<span class="value">${num} ${unit}</span>`);
  }

  function renderTable(table) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    const t = document.createElement('table');
    t.className = 'rule-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    table.headers.forEach((h) => {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    t.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.rows.forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    t.appendChild(tbody);
    wrapper.appendChild(t);

    if (table.footnote) {
      const fn = document.createElement('div');
      fn.className = 'section-text';
      fn.style.fontSize = '12px';
      fn.style.color = 'var(--text-muted)';
      fn.style.marginTop = '6px';
      fn.innerHTML = table.footnote.replace(/\n/g, '<br>');
      wrapper.appendChild(fn);
    }

    return wrapper;
  }

  // ── TOC ──
  function buildTOC() {
    toc.innerHTML = '';
    const ul = buildTOCLevel(currentRule.sections, 0);
    toc.appendChild(ul);
  }

  function buildTOCLevel(sections, depth) {
    const ul = document.createElement('ul');
    ul.className = `toc-level-${depth}`;

    sections.forEach((s) => {
      const li = document.createElement('li');
      li.dataset.sectionId = s.id;

      const item = document.createElement('div');
      item.className = 'toc-item';

      const toggle = document.createElement('span');
      toggle.className = 'toc-toggle' + (s.children.length ? '' : ' leaf');
      toggle.textContent = s.children.length ? '\u25B6' : '';

      const labelSpan = document.createElement('span');
      labelSpan.className = 'toc-label';
      labelSpan.textContent = s.label;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = s.title || '';

      const tocCopyBtns = document.createElement('span');
      tocCopyBtns.className = 'toc-copy-btns';

      const tocCiteBtn = document.createElement('button');
      tocCiteBtn.className = 'copy-btn toc-copy-btn';
      tocCiteBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      tocCiteBtn.title = 'Copy citation';
      tocCiteBtn.addEventListener('click', (e) => { e.stopPropagation(); copyCitation(s, tocCiteBtn); });

      const tocCiteTextBtn = document.createElement('button');
      tocCiteTextBtn.className = 'copy-btn toc-copy-btn';
      tocCiteTextBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/><line x1="13" y1="5" x2="19" y2="5"/><line x1="13" y1="9" x2="19" y2="9"/><line x1="13" y1="13" x2="17" y2="13"/></svg>';
      tocCiteTextBtn.title = 'Copy citation + text';
      tocCiteTextBtn.addEventListener('click', (e) => { e.stopPropagation(); copyCitationWithText(s, tocCiteTextBtn); });

      tocCopyBtns.appendChild(tocCiteBtn);
      tocCopyBtns.appendChild(tocCiteTextBtn);

      item.appendChild(toggle);
      item.appendChild(labelSpan);
      item.appendChild(titleSpan);
      item.appendChild(tocCopyBtns);

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        scrollToSection(s.id);
        closeSidebar();
      });

      li.appendChild(item);

      if (s.children.length) {
        const childUl = buildTOCLevel(s.children, depth + 1);
        const childWrapper = document.createElement('div');
        childWrapper.className = 'toc-children' + (depth >= 2 ? ' collapsed' : '');
        childWrapper.appendChild(childUl);
        li.appendChild(childWrapper);

        if (depth < 2) toggle.classList.add('expanded');

        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggle.classList.toggle('expanded');
          childWrapper.classList.toggle('collapsed');
        });
      }

      ul.appendChild(li);
    });

    return ul;
  }

  function getStickyHeight() {
    return ['#searchBar', '#breadcrumbBar', '.header'].reduce((sum, sel) => {
      return sum + (document.querySelector(sel)?.offsetHeight || 0);
    }, 0);
  }

  function getAbsoluteTop(el) {
    // Walk offsetParent chain for true document position,
    // unaffected by current scroll position or in-progress animations.
    let top = 0;
    let node = el;
    while (node) {
      top += node.offsetTop;
      node = node.offsetParent;
    }
    return top;
  }

  function scrollToSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const targetTop = Math.max(0, getAbsoluteTop(el) - getStickyHeight() - 12);
    window.scrollTo({ top: targetTop, behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    history.replaceState(null, '', '#' + id);
  }

  // ── Scroll Spy ──
  function initScrollSpy() {
    if (observer) observer.disconnect();

    const sections = ruleBody.querySelectorAll('[data-section-id]');
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.dataset.sectionId);
          }
        });
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );
    sections.forEach((s) => observer.observe(s));
  }

  function setActiveSection(id) {
    if (activeSection === id) return;
    activeSection = id;

    // Update TOC highlight
    toc.querySelectorAll('.toc-item.active').forEach((el) => el.classList.remove('active'));
    const tocItem = toc.querySelector(`li[data-section-id="${id}"] > .toc-item`);
    if (tocItem) {
      tocItem.classList.add('active');
      // Scroll only the sidebar — never the window
      const itemTop = tocItem.offsetTop;
      const sidebarEl = sidebar;
      const itemBottom = itemTop + tocItem.offsetHeight;
      const visTop = sidebarEl.scrollTop;
      const visBottom = visTop + sidebarEl.clientHeight;
      if (itemTop < visTop || itemBottom > visBottom) {
        sidebarEl.scrollTop = itemTop - sidebarEl.clientHeight / 2;
      }
      // Expand parents
      expandTOCParents(tocItem);
    }

    // Update breadcrumb
    updateBreadcrumb(id);
  }

  function expandTOCParents(el) {
    let parent = el.closest('.toc-children');
    while (parent) {
      parent.classList.remove('collapsed');
      const toggle = parent.previousElementSibling?.querySelector('.toc-toggle');
      if (toggle) toggle.classList.add('expanded');
      parent = parent.parentElement?.closest('.toc-children');
    }
  }

  // ── Breadcrumb ──
  function updateBreadcrumb(id) {
    const path = findPath(currentRule.sections, id);
    if (!path.length) return;

    breadcrumb.innerHTML = '';

    // Rule root
    const rootCrumb = document.createElement('span');
    rootCrumb.className = 'breadcrumb-item';
    rootCrumb.textContent = `Rule ${currentRule.id}`;
    rootCrumb.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    breadcrumb.appendChild(rootCrumb);

    path.forEach((node, i) => {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '\u203A';
      breadcrumb.appendChild(sep);

      const crumb = document.createElement('span');
      crumb.className = 'breadcrumb-item' + (i === path.length - 1 ? ' active' : '');
      crumb.textContent = `${node.label} ${node.title || ''}`.trim();
      crumb.addEventListener('click', () => scrollToSection(node.id));
      breadcrumb.appendChild(crumb);
    });
  }

  function findPath(sections, targetId, path = []) {
    for (const s of sections) {
      const newPath = [...path, s];
      if (s.id === targetId) return newPath;
      if (s.children.length) {
        const found = findPath(s.children, targetId, newPath);
        if (found.length) return found;
      }
    }
    return [];
  }

  // ── Search ──
  function buildSearchIndex() {
    searchIndex = [];
    flattenForSearch(currentRule.sections, []);

    if (typeof Fuse !== 'undefined') {
      fuse = new Fuse(searchIndex, {
        keys: [
          { name: 'title', weight: 0.35 },
          { name: 'text', weight: 0.45 },
          { name: 'path', weight: 0.2 }
        ],
        threshold: 0.35,
        includeMatches: true,
        ignoreLocation: true,
        minMatchCharLength: 2
      });
    }
  }

  function flattenForSearch(sections, ancestors) {
    sections.forEach((s) => {
      const path = [...ancestors, s.label].join('');
      const breadcrumbStr = [...ancestors.map((a) => a), s.title || s.label].join(' > ');
      searchIndex.push({
        id: s.id,
        label: s.label,
        title: s.title || '',
        text: (s.text || '') + (s.blockquote ? ' ' + s.blockquote : ''),
        path: path,
        breadcrumb: breadcrumbStr,
        topSection: ancestors[0] || s.label
      });
      if (s.children.length) {
        flattenForSearch(s.children, [...ancestors, s.label]);
      }
    });
  }

  function doSearch(query) {
    if (!query || query.length < 2) {
      searchResults.classList.remove('visible');
      searchResults.innerHTML = '';
      clearHighlights();
      return;
    }

    let results;
    if (fuse) {
      results = fuse.search(query).slice(0, 20);
    } else {
      // Fallback: basic substring match
      const lower = query.toLowerCase();
      results = searchIndex
        .filter((item) => item.text.toLowerCase().includes(lower) || item.title.toLowerCase().includes(lower))
        .slice(0, 20)
        .map((item) => ({ item, matches: [] }));
    }

    if (!results.length) {
      searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
      searchResults.classList.add('visible');
      clearHighlights();
      return;
    }

    // Group by top section
    const groups = {};
    results.forEach((r) => {
      const key = r.item.topSection;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    searchResults.innerHTML = '';
    Object.entries(groups).forEach(([section, items]) => {
      const header = document.createElement('div');
      header.className = 'search-group-header';
      header.textContent = section;
      searchResults.appendChild(header);

      items.forEach((r) => {
        const div = document.createElement('div');
        div.className = 'search-result-item';

        const pathEl = document.createElement('div');
        pathEl.className = 'search-result-path';
        pathEl.textContent = r.item.breadcrumb;

        const textEl = document.createElement('div');
        textEl.className = 'search-result-text';
        const snippet = getSnippet(r.item.text, query, 120);
        textEl.innerHTML = highlightText(snippet, query);

        div.appendChild(pathEl);
        div.appendChild(textEl);
        div.addEventListener('click', () => {
          scrollToSection(r.item.id);
          searchResults.classList.remove('visible');
        });
        searchResults.appendChild(div);
      });
    });

    searchResults.classList.add('visible');
    highlightContent(query);
  }

  function getSnippet(text, query, maxLen) {
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query.toLowerCase());
    if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + query.length + maxLen - 40);
    return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
  }

  function highlightText(text, query) {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    return text.replace(re, '<mark>$1</mark>');
  }

  function highlightContent(query) {
    clearHighlights();
    if (!query || query.length < 2) return;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped})`, 'gi');
    const walker = document.createTreeWalker(ruleBody, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      if (!re.test(node.textContent)) return;
      re.lastIndex = 0;
      const span = document.createElement('span');
      span.innerHTML = node.textContent.replace(re, '<mark>$1</mark>');
      node.parentNode.replaceChild(span, node);
    });
  }

  function clearHighlights() {
    ruleBody.querySelectorAll('mark').forEach((mark) => {
      const parent = mark.parentNode;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });
    // Clean up wrapper spans
    ruleBody.querySelectorAll('span:not([class])').forEach((span) => {
      if (span.childNodes.length === 1 && span.childNodes[0].nodeType === Node.TEXT_NODE) {
        span.parentNode.replaceChild(span.childNodes[0], span);
        span.parentNode?.normalize();
      }
    });
  }

  // ── Copy Widget ──
  function buildCitation(node) {
    const path = findPath(currentRule.sections, node.id);
    return `OAC ${currentRule.id}` + path.map((n) => n.label).join('');
  }

  function copyCitation(node, btn) {
    navigator.clipboard.writeText(buildCitation(node)).then(() => showCopyTooltip(btn, 'Copied!'));
  }

  function copyCitationWithText(node, btn) {
    const citation = buildCitation(node);
    const raw = node.text || node.blockquote || node.title || '';
    const text = raw.length > 300 ? raw.slice(0, 300) + '...' : raw;
    navigator.clipboard.writeText(`${citation} — ${text}`).then(() => showCopyTooltip(btn, 'Copied!'));
  }

  function showCopyTooltip(btn, message) {
    const tip = document.createElement('span');
    tip.className = 'copy-tooltip visible';
    tip.textContent = message;
    btn.appendChild(tip);
    setTimeout(() => tip.remove(), 1500);
  }

  // ── Hash Navigation ──
  function handleHash() {
    const hash = location.hash.slice(1);
    if (!hash) return;
    setTimeout(() => {
      scrollToSection(hash);
    }, 100);
  }

  // ── Sidebar Mobile ──
  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
  }

  // ── Events ──
  function bindEvents() {
    themeToggle.addEventListener('click', toggleTheme);

    ruleSelector.addEventListener('change', (e) => loadRule(e.target.value));

    // Search
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = searchInput.value.trim();
      searchClear.classList.toggle('visible', val.length > 0);
      debounceTimer = setTimeout(() => doSearch(val), 300);
    });

    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.classList.remove('visible');
      searchResults.classList.remove('visible');
      searchResults.innerHTML = '';
      clearHighlights();
      searchInput.focus();
    });

    // Close search dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-bar')) {
        searchResults.classList.remove('visible');
      }
    });

    // Keyboard shortcut: / to focus search
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !e.target.closest('input, textarea')) {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === 'Escape') {
        searchResults.classList.remove('visible');
        searchInput.blur();
      }
    });

    // Scroll to top
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 300);
    }, { passive: true });
    scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    // Mobile sidebar
    hamburger.addEventListener('click', () => {
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Hash change
    window.addEventListener('hashchange', handleHash);
  }

  // ── Load Fuse.js dynamically if ESM import didn't work ──
  function ensureFuse(cb) {
    if (typeof Fuse !== 'undefined') return cb();
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';
    script.onload = cb;
    script.onerror = cb; // proceed without search if CDN fails
    document.head.appendChild(script);
  }

  // ── Boot ──
  ensureFuse(() => init());
})();
