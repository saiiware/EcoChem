/* ══════════════════════════════════════════════════════════
   EcoChem — Core Application Script
   Features: Search, AI (Groq API), Dashboard, Analytics
══════════════════════════════════════════════════════════ */

// ── 12 Green Chemistry Principles ────────────────────────
const GREEN_PRINCIPLES = {
  1:  "Prevention",
  2:  "Atom Economy",
  3:  "Less Hazardous Synthesis",
  4:  "Designing Safer Chemicals",
  5:  "Safer Solvents & Auxiliaries",
  6:  "Design for Energy Efficiency",
  7:  "Use of Renewable Feedstocks",
  8:  "Reduce Derivatives",
  9:  "Catalysis",
  10: "Design for Degradation",
  11: "Real-time Pollution Prevention",
  12: "Inherently Safer Chemistry"
};

const TOXIN_COLORS = {
  "VERY HIGH": "#c0392b",
  "HIGH":      "#d47c0a",
  "MEDIUM":    "#1a6b8a",
  "LOW":       "#2d6a4f"
};
const SCORE_COLORS = [
  "#c0392b","#c0392b","#c0392b","#d47c0a",
  "#d47c0a","#5a8a6a","#2d6a4f","#1a4731",
  "#1a4731","#1a4731","#1a4731"
];

// ── State ─────────────────────────────────────────────────
let currentFilter  = 'all';
let currentResults = [];
let chatHistory    = [];
let isAILoading    = false;

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const total = REACTIONS_DB.length;
  document.getElementById('totalCount').textContent      = total;
  document.getElementById('kpiTotal').textContent        = total;
  document.getElementById('aiReactionCount').textContent = total;

  document.getElementById('kpiCritical').textContent =
    REACTIONS_DB.filter(r => r.sustainabilityRating === 'CRITICAL').length;
  document.getElementById('kpiPoor').textContent =
    REACTIONS_DB.filter(r => r.sustainabilityRating === 'POOR').length;
  document.getElementById('kpiGood').textContent =
    REACTIONS_DB.filter(r => ['GOOD','EXCELLENT'].includes(r.sustainabilityRating)).length;

  initCanvas();
  buildDashboard();
  document.getElementById('browseCta').style.display = 'block';
});

// ── Section Navigation ────────────────────────────────────
function showSection(name) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.remove('active'));
  document.getElementById('section-' + name).classList.add('active');
  const pills = document.querySelectorAll('.nav-pill');
  const idx = { search: 0, dashboard: 1, ai: 2 };
  if (pills[idx[name]]) pills[idx[name]].classList.add('active');
}

// ── Filter ────────────────────────────────────────────────
function setFilter(el, industry) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFilter = industry;
  const q = document.getElementById('searchInput').value.trim();
  if (q) doSearch();
  else if (industry !== 'all') {
    const filtered = REACTIONS_DB.filter(r => r.industry === industry);
    renderCards(filtered);
    document.getElementById('sortBar').style.display = 'flex';
    document.getElementById('resultCount').textContent = filtered.length + ' reactions';
    currentResults = filtered;
  }
}

// ── Live Search + Autocomplete ────────────────────────────
function liveSearch() {
  const q = document.getElementById('searchInput').value.trim();
  document.getElementById('clearBtn').style.display = q ? 'block' : 'none';

  if (q.length < 2) { hideSuggestions(); return; }

  const lower = q.toLowerCase();
  const seen  = new Set();
  const sugs  = [];

  REACTIONS_DB.forEach(r => {
    if (r.product.toLowerCase().includes(lower) && !seen.has(r.product)) {
      sugs.push({ text: r.product, type: 'product', r });
      seen.add(r.product);
    }
    if (r.process.toLowerCase().includes(lower) && !seen.has(r.process)) {
      sugs.push({ text: r.process, type: 'process', r });
      seen.add(r.process);
    }
    r.toxins.forEach(t => {
      const tKey = t.split('(')[0].trim();
      if (t.toLowerCase().includes(lower) && !seen.has(tKey)) {
        sugs.push({ text: tKey, type: 'toxin', r });
        seen.add(tKey);
      }
    });
  });

  if (!sugs.length) { hideSuggestions(); return; }

  const box = document.getElementById('suggestions');
  box.innerHTML = sugs.slice(0, 6).map(s => `
    <div class="suggestion-item" onclick="selectSuggestion('${esc(s.text)}')">
      <span class="sug-type">${s.type}</span>
      <span>${esc(s.text)}</span>
    </div>`).join('');
  box.style.display = 'block';
}

function selectSuggestion(text) {
  document.getElementById('searchInput').value = text;
  hideSuggestions();
  doSearch();
}
function hideSuggestions() {
  document.getElementById('suggestions').style.display = 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest('.search-bar')) hideSuggestions();
});

// ── ML-Style Scoring ──────────────────────────────────────
function scoreRelevance(r, terms) {
  let score = 0;
  const fields = [
    { text: r.product, w: 5 },
    { text: r.reactants, w: 4 },
    { text: r.process, w: 3 },
    { text: r.industry, w: 2 },
    { text: r.info, w: 1 },
    { text: r.toxins.join(' '), w: 3 },
    { text: r.greenAlternatives.join(' '), w: 2 },
    { text: r.equation, w: 2 }
  ];
  terms.forEach(term => {
    fields.forEach(f => {
      const count = (f.text.toLowerCase().split(term).length - 1);
      score += count * f.w;
    });
  });
  return score;
}

// ── Main Search ───────────────────────────────────────────
function doSearch() {
  hideSuggestions();
  const raw = document.getElementById('searchInput').value.trim();
  if (!raw) { browseAll(); return; }

  const stopWords = new Set(['the','a','an','of','in','and','or','for','is','are','to','from','with','by','at','as']);
  const terms = raw.toLowerCase()
    .split(/\s+/)
    .filter(t => t.length > 1 && !stopWords.has(t));

  let pool = currentFilter === 'all' ? REACTIONS_DB :
    REACTIONS_DB.filter(r => r.industry === currentFilter);

  const scored = pool
    .map(r => ({ r, score: scoreRelevance(r, terms) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  currentResults = scored.map(x => x.r);

  document.getElementById('sortBar').style.display = 'flex';
  document.getElementById('resultCount').textContent =
    currentResults.length
      ? currentResults.length + ' reaction' + (currentResults.length > 1 ? 's' : '') + ' found'
      : 'No results';

  renderCards(currentResults);
  document.getElementById('browseCta').style.display = 'none';
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('clearBtn').style.display = 'none';
  document.getElementById('results').innerHTML = '';
  document.getElementById('sortBar').style.display = 'none';
  document.getElementById('browseCta').style.display = 'block';
  hideSuggestions();
}

function browseAll() {
  currentResults = currentFilter === 'all' ? [...REACTIONS_DB] :
    REACTIONS_DB.filter(r => r.industry === currentFilter);
  renderCards(currentResults);
  document.getElementById('sortBar').style.display = 'flex';
  document.getElementById('resultCount').textContent = currentResults.length + ' reactions';
  document.getElementById('browseCta').style.display = 'none';
}

// ── Sort ──────────────────────────────────────────────────
function sortResults() {
  const v = document.getElementById('sortSelect').value;
  let sorted = [...currentResults];
  if (v === 'greenScore-asc') sorted.sort((a,b) => a.greenScore - b.greenScore);
  else if (v === 'greenScore-desc') sorted.sort((a,b) => b.greenScore - a.greenScore);
  else if (v === 'toxin-desc') {
    const order = { 'VERY HIGH': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    sorted.sort((a,b) => (order[b.toxinLevel]||0) - (order[a.toxinLevel]||0));
  }
  else if (v === 'industry') sorted.sort((a,b) => a.industry.localeCompare(b.industry));
  renderCards(sorted, false);
}

// ── Render Cards ──────────────────────────────────────────
function renderCards(list, animate = true) {
  const div = document.getElementById('results');
  div.innerHTML = '';

  if (!list.length) {
    div.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 24px;">
      <div style="font-size:48px;margin-bottom:16px;">🌿</div>
      <div style="font-family:var(--font-head);font-size:24px;color:var(--forest);font-weight:700;margin-bottom:8px;">No reactions found</div>
      <p style="font-size:16px;color:var(--text-3);">Try broader terms: chemical name, industry, or toxin</p>
    </div>`;
    return;
  }

  list.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'reaction-card';
    card.onclick = () => openModal(r);

    const score = r.greenScore;
    const scoreClass = score <= 3 ? 'score-1' : score <= 5 ? 'score-4' : score <= 7 ? 'score-6' : 'score-8';
    const toxinClass = 'toxin-' + (r.toxinLevel || '').toLowerCase().replace(' ','-');
    const scoreColor = SCORE_COLORS[Math.min(score, 10)];

    const topToxins = r.toxins.slice(0, 2).map(t =>
      `<span class="card-tag">${esc(t.split('(')[0].trim())}</span>`
    ).join('');

    // Sustainability emoji
    const sustEmoji = {
      'CRITICAL': '🔴', 'POOR': '🟠', 'MODERATE': '🟡', 'GOOD': '🟢', 'EXCELLENT': '✅'
    }[r.sustainabilityRating] || '⚪';

    card.innerHTML = `
      <div class="card-industry">${esc(r.industry)}</div>
      <div class="card-product">${esc(r.product)}</div>
      <div class="card-process">${esc(r.process)}</div>
      <div class="card-meta">
        <div class="score-pill ${scoreClass}">
          <svg width="14" height="14" viewBox="0 0 14 14" style="flex-shrink:0">
            <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4" opacity="0.3"/>
            <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.4"
              stroke-dasharray="${2*Math.PI*5.5}"
              stroke-dashoffset="${2*Math.PI*5.5 - (score/10)*2*Math.PI*5.5}"
              transform="rotate(-90 7 7)"/>
          </svg>
          ${score}/10 Green Score
        </div>
        <span class="toxin-badge ${toxinClass}">${r.toxinLevel}</span>
      </div>
      <div class="card-tags">${topToxins}</div>
      <div class="card-footer">
        <span>${sustEmoji} ${r.sustainabilityRating}</span>
        <span class="card-view-btn">View full analysis →</span>
      </div>`;

    if (animate) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(16px)';
      setTimeout(() => {
        card.style.transition = 'opacity .35s ease, transform .35s ease';
        card.style.opacity = '1';
        card.style.transform = 'none';
      }, i * 55);
    }

    div.appendChild(card);
  });
}

// ── Modal (FULLSCREEN) ─────────────────────────────────────
function openModal(r) {
  const principles = (r.greenPrinciples || []).map(p =>
    `<span class="p-badge">P${p}: ${GREEN_PRINCIPLES[p]}</span>`
  ).join('');

  const toxinList = r.toxins.map(t =>
    `<div class="modal-toxin-item"><span class="toxin-ico">⚠</span>${esc(t)}</div>`
  ).join('');

  const altList = r.greenAlternatives.map(a =>
    `<div class="modal-alt-item"><span class="alt-ico">🌱</span>${esc(a)}</div>`
  ).join('');

  const scoreColor = SCORE_COLORS[Math.min(r.greenScore, 10)];
  const scoreBarPct = (r.greenScore / 10) * 100;

  document.getElementById('modalContent').innerHTML = `
    <!-- Hero band -->
    <div class="modal-hero-band">
      <div class="modal-industry">${esc(r.industry)} &nbsp;·&nbsp; ${esc(r.id)}</div>
      <div class="modal-product">${esc(r.product)}</div>
      <div class="modal-process">${esc(r.process)}</div>
    </div>

    <!-- Body content -->
    <div class="modal-content-inner">

      <!-- Score row -->
      <div class="modal-score-row">
        <div class="score-big" style="color:${scoreColor}">${r.greenScore}</div>
        <div class="score-meta">
          <div class="score-label">GREEN SCORE / 10</div>
          <div class="score-bar-track">
            <div class="score-bar-fill" style="width:${scoreBarPct}%;background:${scoreColor}"></div>
          </div>
          <div style="font-size:14px;color:var(--text-2);margin-top:8px;font-weight:600;">${r.sustainabilityRating} · Toxin Level: ${r.toxinLevel}</div>
        </div>
      </div>

      <!-- Chemical equation -->
      <div class="modal-eq">${esc(r.equation)}</div>

      <!-- Info -->
      <div class="modal-section">
        <div class="modal-section-title">About this Reaction</div>
        <div style="font-size:16px;color:var(--text-2);line-height:1.75;">${esc(r.info)}</div>
      </div>

      <!-- Conditions -->
      <div class="modal-section">
        <div class="modal-section-title">Process Conditions</div>
        <div style="font-size:15px;color:var(--text-1);background:var(--mist);border:1.5px solid rgba(64,145,108,0.2);border-radius:12px;padding:16px 20px;font-family:var(--font-mono);">${esc(r.conditions)}</div>
      </div>

      <!-- Reactants -->
      <div class="modal-section">
        <div class="modal-section-title">Reactants</div>
        <div style="font-size:15px;color:var(--text-1);background:var(--mist);border:1.5px solid rgba(64,145,108,0.2);border-radius:12px;padding:16px 20px;">${esc(r.reactants)}</div>
      </div>

      <!-- Toxins -->
      <div class="modal-section">
        <div class="modal-section-title">⚠ Toxins & Hazardous Byproducts</div>
        <div class="modal-toxins">${toxinList}</div>
      </div>

      <!-- Environmental Impact -->
      <div class="modal-section">
        <div class="modal-section-title">🌍 Real-World Environmental Impact</div>
        <div class="modal-impact">${esc(r.realWorldImpact)}</div>
      </div>

      <!-- Annual Waste -->
      <div class="modal-section">
        <div class="modal-section-title">📊 Annual Waste Estimate</div>
        <div style="font-size:15px;color:#9a5a00;font-family:var(--font-mono);background:rgba(212,124,10,0.08);border:1.5px solid rgba(212,124,10,0.25);padding:16px 20px;border-radius:12px;font-weight:600;">${esc(r.annualWaste)}</div>
      </div>

      <!-- Green Alternatives -->
      <div class="modal-section">
        <div class="modal-section-title">🌱 Green Chemistry Alternatives</div>
        <div class="modal-alts">${altList}</div>
      </div>

      ${principles ? `<div class="modal-section">
        <div class="modal-section-title">📋 Green Chemistry Principles Violated</div>
        <div class="modal-principles">${principles}</div>
      </div>` : ''}

      <!-- Ask AI button -->
      <div style="margin-top:40px;padding-top:24px;border-top:2px solid var(--mist);display:flex;gap:12px;flex-wrap:wrap;">
        <button onclick="askAIAbout('${esc(r.product)}')" style="
          font-family:var(--font-body);font-size:15px;font-weight:700;
          padding:14px 28px;border-radius:100px;
          border:2px solid var(--forest);
          background:var(--forest);color:#ffffff;
          cursor:pointer;transition:all .2s;
          box-shadow:0 4px 14px rgba(29,77,46,0.3);">
          🤖 Ask AI about ${esc(r.product)}
        </button>
        <button onclick="closeModalBtn()" style="
          font-family:var(--font-body);font-size:15px;font-weight:600;
          padding:14px 28px;border-radius:100px;
          border:2px solid var(--border-hi);
          background:transparent;color:var(--text-2);
          cursor:pointer;transition:all .2s;">
          ← Back to Search
        </button>
      </div>

    </div>`;

  document.getElementById('modal').classList.add('open');
  document.getElementById('modalBox').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}

function closeModal(e) {
  if (e.target === document.getElementById('modal')) closeModalBtn();
}
function closeModalBtn() {
  document.getElementById('modal').classList.remove('open');
  document.body.style.overflow = '';
}

// Keyboard ESC to close modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModalBtn();
});

function askAIAbout(product) {
  closeModalBtn();
  showSection('ai');
  document.getElementById('chatInput').value =
    `What are the green chemistry alternatives for ${product} production? Give specific improvements.`;
  sendAI();
}

// ── Dashboard Builder ─────────────────────────────────────
function buildDashboard() {
  buildBarChart();
  buildDonut();
  buildHeatmap();
  buildPrinciples();
}

function buildBarChart() {
  const byIndustry = {};
  REACTIONS_DB.forEach(r => {
    if (!byIndustry[r.industry]) byIndustry[r.industry] = [];
    byIndustry[r.industry].push(r.greenScore);
  });

  const rows = Object.entries(byIndustry)
    .map(([ind, scores]) => ({
      label: ind,
      avg: scores.reduce((a,b) => a+b,0) / scores.length
    }))
    .sort((a,b) => a.avg - b.avg);

  const container = document.getElementById('barChart');
  container.innerHTML = rows.map(row => {
    const pct = (row.avg / 10) * 100;
    const color = SCORE_COLORS[Math.round(row.avg)];
    const shortLabel = row.label.replace(' & ', '/').replace('Petrochemicals','Petrochem').replace('Semiconductors','Semicon');
    return `<div class="bar-row">
      <div class="bar-lbl" title="${row.label}">${shortLabel}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:0%;background:${color}" data-w="${pct}"></div>
      </div>
      <div class="bar-val">${row.avg.toFixed(1)}</div>
    </div>`;
  }).join('');

  setTimeout(() => {
    container.querySelectorAll('.bar-fill').forEach(b => {
      b.style.transition = 'width .7s cubic-bezier(.4,0,.2,1)';
      b.style.width = b.dataset.w + '%';
    });
  }, 200);
}

function buildDonut() {
  const counts = { 'VERY HIGH': 0, 'HIGH': 0, 'MEDIUM': 0, 'LOW': 0 };
  REACTIONS_DB.forEach(r => { if (counts[r.toxinLevel] !== undefined) counts[r.toxinLevel]++; });
  const total  = REACTIONS_DB.length;
  const colors = {
    'VERY HIGH': '#c0392b',
    'HIGH':      '#d47c0a',
    'MEDIUM':    '#1a6b8a',
    'LOW':       '#2d6a4f'
  };

  const wrap = document.getElementById('donutChart');
  const r = 52, circ = 2 * Math.PI * r;
  let offset = 0;
  let segments = '';

  Object.entries(counts).forEach(([level, count]) => {
    if (!count) return;
    const fraction = count / total;
    const dashLen  = fraction * circ;
    const gap      = circ - dashLen;
    segments += `<circle cx="70" cy="70" r="${r}" fill="none"
      stroke="${colors[level]}" stroke-width="16"
      stroke-dasharray="${dashLen} ${gap}"
      stroke-dashoffset="${-offset * circ}"/>`;
    offset += fraction;
  });

  wrap.innerHTML = `
    <div class="donut-svg-wrap">
      <svg viewBox="0 0 140 140" width="170" height="170">
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="${'rgba(64,145,108,0.1)'}" stroke-width="16"/>
        ${segments}
      </svg>
      <div class="donut-center"><small>Total</small>${total}</div>
    </div>
    <div class="donut-legend">
      ${Object.entries(counts).map(([level, count]) => `
        <div class="legend-item">
          <div class="legend-dot" style="background:${colors[level]}"></div>
          <span><strong>${count}</strong> ${level}</span>
        </div>`).join('')}
    </div>`;
}

function buildHeatmap() {
  const grid   = document.getElementById('heatmap');
  const sorted = [...REACTIONS_DB].sort((a,b) => a.greenScore - b.greenScore);
  const colors  = {
    'CRITICAL': '#c0392b',
    'POOR':     '#d47c0a',
    'MODERATE': '#1a6b8a',
    'GOOD':     '#2d6a4f',
    'EXCELLENT':'#1a4731'
  };
  const bgAlpha = { 'CRITICAL':'0.18','POOR':'0.15','MODERATE':'0.12','GOOD':'0.15','EXCELLENT':'0.15' };

  grid.innerHTML = sorted.map(r => {
    const c    = colors[r.sustainabilityRating] || '#888';
    const a    = bgAlpha[r.sustainabilityRating] || '0.1';
    const barW = (r.greenScore / 10) * 100;
    return `<div class="hm-row">
      <div class="hm-label" title="${r.industry}">${r.product}</div>
      <div class="hm-cell" onclick="openModal(REACTIONS_DB.find(x=>x.id==='${r.id}'))"
        style="background:rgba(${hexToRGB(c)},${a});">
        <div style="position:absolute;left:0;top:0;bottom:0;width:${barW}%;background:rgba(${hexToRGB(c)},0.25);"></div>
        <span style="position:relative;z-index:1;">${r.process}</span>
        <span style="position:absolute;right:10px;font-family:var(--font-mono);font-size:11px;color:${c};font-weight:600;">${r.greenScore}/10</span>
      </div>
    </div>`;
  }).join('');
}

function buildPrinciples() {
  const counts = {};
  for (let i = 1; i <= 12; i++) counts[i] = 0;
  REACTIONS_DB.forEach(r => (r.greenPrinciples || []).forEach(p => { counts[p] = (counts[p]||0)+1; }));
  const max = Math.max(...Object.values(counts));

  const grid = document.getElementById('principlesChart');
  grid.innerHTML = Object.entries(counts).map(([num, count]) => {
    const pct   = count / max;
    const color = pct > 0.6 ? '#c0392b' : pct > 0.3 ? '#d47c0a' : '#2d6a4f';
    return `<div class="principle-item" title="${GREEN_PRINCIPLES[num]}">
      <div class="p-num" style="color:${color}">${num}</div>
      <div class="p-name">${GREEN_PRINCIPLES[num]}</div>
      <div class="p-count" style="color:${color}">${count} reactions</div>
    </div>`;
  }).join('');
}

function hexToRGB(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

// ── AI Advisor (Groq API) ─────────────────────────────────
function usePrompt(el) {
  // Strip emoji from start of button text
  const text = el.textContent.replace(/^[\u{1F300}-\u{1FFFF}\u2600-\u26FF\u2700-\u27BF\s]+/u, '').trim();
  document.getElementById('chatInput').value = text;
}

async function sendAI() {
  if (isAILoading) return;
  const input   = document.getElementById('chatInput');
  const userMsg = input.value.trim();
  if (!userMsg) return;

  input.value  = '';
  isAILoading  = true;
  document.getElementById('sendBtn').disabled = true;

  appendChatMsg(userMsg, 'user');

  const dbSummary = buildDBSummary();
  const typingId  = appendTyping();

  chatHistory.push({ role: 'user', content: userMsg });

  try {
    const systemPrompt = `You are EcoChem AI, an expert green chemistry advisor and industrial sustainability consultant. You have deep knowledge of:
- The 12 Principles of Green Chemistry
- Industrial chemical processes and their environmental impacts
- Sustainable alternatives, cleaner production methods, and circular economy principles
- Toxicology, waste management, and pollution prevention

You have access to the following industrial reaction database summary:
${dbSummary}

When answering:
1. Be specific and actionable — cite real technologies, named processes, and companies where relevant
2. Use the green chemistry principles framework
3. Quantify improvements where possible (e.g. "reduces CO₂ by 70%", "E-factor drops from 40 to 5")
4. Structure longer answers with clear sections
5. Always link recommendations to real-world feasibility
6. Format responses clearly with line breaks between sections

Keep responses focused, scientific, and practical for industrial decision-makers.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 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'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatHistory
        ]
      })
    });

    removeTyping(typingId);

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${response.status}`);
    }

    const data  = await response.json();
    const reply = data.choices[0].message.content;

    chatHistory.push({ role: 'assistant', content: reply });
    appendChatMsg(reply, 'assistant');

  } catch (err) {
    removeTyping(typingId);
    appendChatMsg(
      `Unable to connect to AI service. Please check your Groq API key or internet connection.\n\n**Note:** The Search and Dashboard sections work fully offline.\n\n_Error: ${err.message}_`,
      'assistant', true
    );
  }

  isAILoading = false;
  document.getElementById('sendBtn').disabled = false;
}

function buildDBSummary() {
  const industries = [...new Set(REACTIONS_DB.map(r => r.industry))];
  const criticals  = REACTIONS_DB.filter(r => r.sustainabilityRating === 'CRITICAL').map(r => r.product);
  const avgScore   = (REACTIONS_DB.reduce((s,r) => s + r.greenScore, 0) / REACTIONS_DB.length).toFixed(1);

  return `Database contains ${REACTIONS_DB.length} industrial reactions across industries: ${industries.join(', ')}.
Average green score: ${avgScore}/10.
Critical sustainability risks: ${criticals.join(', ')}.
Key toxins covered: VCM (PVC production), CS₂ (rayon), cyanide (gold mining), PFCs (aluminium), dioxins (textiles), SO₂ (copper/refining), nitrates (fertilizers).
Green Chemistry principles most frequently violated: Prevention (P1), Less Hazardous Synthesis (P3), Safer Solvents (P5), Renewable Feedstocks (P7), Design for Degradation (P10).`;
}

function appendChatMsg(text, role, isError = false) {
  const win = document.getElementById('chatWindow');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  const avatar = role === 'user' ? 'You' : '🌿';
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-body">${formatAIText(text)}</div>`;
  if (isError) div.querySelector('.msg-body').style.borderColor = 'rgba(192,57,43,0.3)';
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
}

function appendTyping() {
  const win = document.getElementById('chatWindow');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  const id = 'typing-' + Date.now();
  div.id = id;
  div.innerHTML = `<div class="msg-avatar">🌿</div>
    <div class="msg-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  win.appendChild(div);
  win.scrollTop = win.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatAIText(text) {
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code style="font-family:var(--font-mono);font-size:13px;background:rgba(64,145,108,0.1);padding:2px 6px;border-radius:4px;color:var(--forest);">$1</code>')
    .replace(/^#{1,3}\s(.+)$/gm, '<div style="font-family:var(--font-head);font-size:16px;font-weight:700;color:var(--forest);margin:12px 0 6px;">$1</div>')
    .replace(/^[-•]\s(.+)$/gm, '<div style="padding-left:16px;margin:4px 0">🌿 $1</div>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

// ── Animated Background Canvas (Green particles) ──────────
function initCanvas() {
  const canvas   = document.getElementById('bgCanvas');
  const ctx      = canvas.getContext('2d');
  const ELEMENTS = ['C','H','O','N','S','Fe','Cu','Al','Cl','P'];
  const COLORS   = [
    'rgba(64,145,108,',
    'rgba(82,183,136,',
    'rgba(116,198,157,',
    'rgba(29,77,46,'
  ];
  let W, H, nodes, edges;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    build();
  }

  function build() {
    const n = Math.min(Math.floor(W * H / 30000), 50);
    nodes = Array.from({ length: n }, () => ({
      x:   Math.random() * W,
      y:   Math.random() * H,
      vx:  (Math.random() - .5) * .2,
      vy:  (Math.random() - .5) * .2,
      r:   Math.random() * 2.5 + 1.5,
      col: COLORS[Math.random() * COLORS.length | 0],
      lbl: ELEMENTS[Math.random() * ELEMENTS.length | 0],
      ph:  Math.random() * Math.PI * 2,
      ps:  .012 + Math.random() * .01
    }));
    rebuildEdges();
  }

  function rebuildEdges() {
    edges = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i+1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        if (dx*dx + dy*dy < 130*130) edges.push([i,j]);
      }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    edges.forEach(([i,j]) => {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(b.x-a.x, b.y-a.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = `rgba(64,145,108,${(1-d/130)*0.18})`;
      ctx.lineWidth = .8;
      ctx.stroke();
    });

    nodes.forEach(n => {
      n.ph += n.ps;
      const g = Math.sin(n.ph) * .5 + .5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r * (1 + g * 0.3), 0, Math.PI*2);
      ctx.fillStyle = n.col + (0.25 + g*.3) + ')';
      ctx.fill();
      n.x += n.vx; n.y += n.vy;
      if (n.x < -10) n.x = W+10;
      if (n.x > W+10) n.x = -10;
      if (n.y < -10) n.y = H+10;
      if (n.y > H+10) n.y = -10;
    });

    if (Math.random() < .012) rebuildEdges();
    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', resize);
  resize();
  draw();
}

// ── Utility ───────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}