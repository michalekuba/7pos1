const QUESTION_FILES = [
  'questions/exam_pos1_banks.xml',
  'questions/test_prednaska01_v2_moodle.xml',
  'questions/test_prednaska02_moodle.xml',
  'questions/test_prednaska03_moodle.xml',
  'questions/test_prednaska04_moodle.xml',
  'questions/test_prednaska05_moodle.xml',
  'questions/test_prednaska06_moodle.xml',
  'questions/test_prednaska07_moodle.xml',
  'questions/test_prednaska08_moodle.xml',
  'questions/test_prednaska09_moodle.xml',
  'questions/test_prednaska10_moodle.xml',
  'questions/test_prednaska11_moodle.xml',
  'questions/test_prednaska12_moodle.xml',
];

const TYPE_LABELS = {
  multichoice: 'Výběr',
  truefalse: 'Pravda / Nepravda',
  shortanswer: 'Krátká odpověď',
  matching: 'Přiřazování',
  cloze: 'Doplňování',
  essay: 'Esej',
};

const state = {
  questions: [],
  filtered: [],
  search: '',
  lecture: '',
  type: '',
  theme: 'auto',
};

const els = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  els.themeToggle = document.getElementById('themeToggle');
  els.themeDropdown = document.querySelector('.theme-dropdown');
  els.messageBar = document.getElementById('messageBar');
  els.toolbar = document.getElementById('toolbar');
  els.searchInput = document.getElementById('searchInput');
  els.lectureFilter = document.getElementById('lectureFilter');
  els.typeFilter = document.getElementById('typeFilter');
  els.counterLine = document.getElementById('counterLine');
  els.content = document.getElementById('content');

  setupThemeDropdown();
  loadThemePreference();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'auto') {
      applyTheme('auto');
    }
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value.trim().toLowerCase();
    applyFilters();
  });
  els.lectureFilter.addEventListener('change', () => {
    state.lecture = els.lectureFilter.value;
    applyFilters();
  });
  els.typeFilter.addEventListener('change', () => {
    state.type = els.typeFilter.value;
    applyFilters();
  });

  if (window.location.protocol === 'file:') {
    showMessage('Pro načtení XML souborů spusť lokální server v adresáři projektu, např. v PowerShellu: py -m http.server 8000 a otevři http://localhost:8000/study.html', 'error');
    return;
  }

  loadAll();
}

async function loadAll() {
  showMessage('Načítám otázky…', 'warning');
  const parsed = [];

  for (const filePath of QUESTION_FILES) {
    try {
      const response = await fetch(filePath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      parsed.push(...parseQuizXml(text, filePath));
    } catch (error) {
      console.warn(`Nepodařilo se načíst ${filePath}: ${error.message}`);
    }
  }

  state.questions = dedupeQuestions(parsed);
  if (!state.questions.length) {
    showMessage('Nepodařilo se načíst žádné otázky.', 'error');
    return;
  }

  hideMessage();
  els.toolbar.classList.remove('hidden');
  populateLectureFilter();
  applyFilters();
}

function parseQuizXml(xmlText, sourceFile) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return [];
  }

  const questions = [];
  let currentCategory = '';

  for (const node of Array.from(doc.documentElement.children || [])) {
    if (node.tagName !== 'question') continue;

    const type = node.getAttribute('type') || '';
    if (type === 'category') {
      currentCategory = getNodeText(node, 'category > text');
      continue;
    }

    const question = {
      id: `${sourceFile}::${type}::${getNodeText(node, 'name > text')}`,
      sourceFile,
      categoryPath: currentCategory,
      type,
      name: stripHtml(getNodeText(node, 'name > text')),
      questionTextHtml: getNodeText(node, 'questiontext > text'),
      generalFeedbackHtml: getNodeText(node, 'generalfeedback > text'),
    };

    if (type === 'multichoice' || type === 'truefalse' || type === 'shortanswer') {
      if (type === 'multichoice') {
        question.single = getNodeText(node, 'single').trim().toLowerCase() === 'true';
      }
      question.answers = Array.from(node.children)
        .filter((child) => child.tagName === 'answer')
        .map((answerNode, index) => ({
          index,
          fraction: Number(answerNode.getAttribute('fraction') || 0),
          textHtml: getNodeText(answerNode, 'text'),
          feedbackHtml: getNodeText(answerNode, 'feedback > text'),
        }));
    } else if (type === 'matching') {
      question.subquestions = Array.from(node.children)
        .filter((child) => child.tagName === 'subquestion')
        .map((subNode, index) => ({
          index,
          promptHtml: getNodeText(subNode, 'text'),
          answerText: stripHtml(getNodeText(subNode, 'answer > text')),
        }));
    } else if (type === 'cloze') {
      const parsedCloze = parseClozeQuestion(question.questionTextHtml);
      question.questionTextHtml = parsedCloze.renderedHtml;
      question.clozeBlanks = parsedCloze.blanks;
    } else if (type === 'essay') {
      question.essayHint = stripHtml(question.generalFeedbackHtml || '');
    }

    questions.push(question);
  }

  return questions;
}

function parseClozeQuestion(html) {
  const blanks = [];
  let renderedHtml = '';
  let lastIndex = 0;
  const regex = /\{(\d+):([A-Za-z]+):([^}]*)\}/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    renderedHtml += html.slice(lastIndex, match.index);
    const blankIndex = blanks.length;
    const answerParts = match[3]
      .split('~')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^=/, '').split('#')[0].trim())
      .filter(Boolean);

    blanks.push({
      blankIndex,
      points: Number(match[1]),
      kind: match[2].toUpperCase(),
      acceptedAnswers: answerParts,
    });

    const primary = answerParts[0] || '…';
    const alternates = answerParts.slice(1);
    const tooltip = alternates.length ? `Také přijato: ${alternates.join(' / ')}` : '';
    renderedHtml += `<span class="cloze-fill" title="${escapeAttr(tooltip)}"><span class="cloze-fill-primary">${escapeHtml(primary)}</span>${alternates.length ? `<span class="cloze-fill-alts"> (nebo ${alternates.map(escapeHtml).join(' / ')})</span>` : ''}</span>`;
    lastIndex = match.index + match[0].length;
  }

  renderedHtml += html.slice(lastIndex);
  return { renderedHtml, blanks };
}

function dedupeQuestions(questions) {
  const map = new Map();
  for (const question of questions) {
    const key = `${question.type}::${normalizeKey(question.name)}`;
    const existing = map.get(key);
    if (!existing || isBankFile(question.sourceFile)) {
      map.set(key, question);
    }
  }
  return Array.from(map.values());
}

function isBankFile(fileName) {
  return /exam_pos1_banks\.xml$/i.test(fileName);
}

function lectureKey(question) {
  const sourceMatch = question.sourceFile.match(/test_prednaska(\d+)/i);
  if (sourceMatch) return `P${sourceMatch[1].padStart(2, '0')}`;

  const categoryMatch = question.categoryPath.match(/Přednáška\s+(\d+)/i);
  if (categoryMatch) return `P${categoryMatch[1].padStart(2, '0')}`;

  if (/Esejový bank/i.test(question.categoryPath)) return 'Eseje';
  return 'Ostatní';
}

function lectureLabel(question) {
  const key = lectureKey(question);
  const categoryMatch = question.categoryPath.match(/Přednáška\s+\d+[^/$]*/i);
  if (categoryMatch) {
    return `${key} – ${categoryMatch[0].replace(/\s+/g, ' ').trim()}`;
  }
  return key;
}

function populateLectureFilter() {
  const labels = new Map();
  for (const question of state.questions) {
    const key = lectureKey(question);
    if (!labels.has(key)) {
      labels.set(key, lectureLabel(question));
    }
  }

  const sortedKeys = Array.from(labels.keys()).sort((a, b) => a.localeCompare(b, 'cs'));
  els.lectureFilter.innerHTML = '<option value="">Všechny přednášky</option>' +
    sortedKeys.map((key) => `<option value="${escapeAttr(key)}">${escapeHtml(labels.get(key))}</option>`).join('');
}

function applyFilters() {
  const search = state.search;
  const lecture = state.lecture;
  const type = state.type;

  state.filtered = state.questions.filter((question) => {
    if (lecture && lectureKey(question) !== lecture) return false;
    if (type && question.type !== type) return false;
    if (search && !matchesSearch(question, search)) return false;
    return true;
  });

  renderContent();
}

function matchesSearch(question, term) {
  const haystack = [
    question.name,
    stripHtml(question.questionTextHtml),
    stripHtml(question.generalFeedbackHtml),
    ...(question.answers || []).map((answer) => stripHtml(answer.textHtml)),
    ...(question.subquestions || []).map((sub) => `${stripHtml(sub.promptHtml)} ${sub.answerText}`),
    ...(question.clozeBlanks || []).flatMap((blank) => blank.acceptedAnswers),
  ].join('  ').toLowerCase();
  return haystack.includes(term);
}

function renderContent() {
  els.content.innerHTML = '';
  const total = state.filtered.length;
  const all = state.questions.length;
  els.counterLine.textContent = total === all
    ? `Zobrazeno ${total} otázek.`
    : `Zobrazeno ${total} z ${all} otázek.`;

  if (!total) {
    els.content.innerHTML = '<div class="card-surface empty-card">Žádné otázky neodpovídají filtrům.</div>';
    return;
  }

  const groups = new Map();
  for (const question of state.filtered) {
    const key = lectureKey(question);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(question);
  }

  const sortedKeys = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, 'cs'));
  for (const key of sortedKeys) {
    const groupEl = document.createElement('section');
    groupEl.className = 'study-group';
    const questions = groups.get(key);
    const label = lectureLabel(questions[0]);

    const header = document.createElement('header');
    header.className = 'study-group-header card-surface';
    header.innerHTML = `<h2>${escapeHtml(label)}</h2><span class="study-group-count">${questions.length} otázek</span>`;
    groupEl.appendChild(header);

    questions.sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }));
    for (const question of questions) {
      groupEl.appendChild(renderQuestionCard(question));
    }

    els.content.appendChild(groupEl);
  }
}

function renderQuestionCard(question) {
  const card = document.createElement('article');
  card.className = 'study-question card-surface';

  const meta = document.createElement('div');
  meta.className = 'study-meta';
  meta.innerHTML = `
    <span class="badge badge-type">${escapeHtml(TYPE_LABELS[question.type] || question.type)}</span>
    ${question.name ? `<span class="badge badge-name">${escapeHtml(question.name)}</span>` : ''}
    <span class="badge badge-source" title="${escapeAttr(question.sourceFile)}">${escapeHtml(shortSource(question.sourceFile))}</span>
  `;
  card.appendChild(meta);

  const text = document.createElement('div');
  text.className = 'study-question-text';
  text.innerHTML = question.questionTextHtml || '';
  card.appendChild(text);

  const body = renderQuestionBody(question);
  if (body) card.appendChild(body);

  if (question.generalFeedbackHtml && question.type !== 'cloze' && question.type !== 'essay') {
    const note = document.createElement('div');
    note.className = 'study-explain';
    note.innerHTML = `<strong>Vysvětlení:</strong> ${question.generalFeedbackHtml}`;
    card.appendChild(note);
  }

  return card;
}

function renderQuestionBody(question) {
  if (question.type === 'multichoice') return renderMultichoiceBody(question);
  if (question.type === 'truefalse') return renderTrueFalseBody(question);
  if (question.type === 'shortanswer') return renderShortAnswerBody(question);
  if (question.type === 'matching') return renderMatchingBody(question);
  if (question.type === 'cloze') return renderClozeBody(question);
  if (question.type === 'essay') return renderEssayBody(question);
  return null;
}

function renderMultichoiceBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-options';

  const positives = question.answers.filter((a) => a.fraction > 0).length;
  const hint = document.createElement('p');
  hint.className = 'study-hint';
  hint.textContent = question.single
    ? 'Jedna správná odpověď.'
    : `Více správných odpovědí (${positives}).`;
  wrap.appendChild(hint);

  for (const answer of question.answers) {
    const correct = answer.fraction > 0;
    const row = document.createElement('div');
    row.className = `study-option ${correct ? 'is-correct' : 'is-incorrect'}`;
    row.innerHTML = `
      <span class="study-mark" aria-hidden="true">${correct ? '✓' : '✗'}</span>
      <div class="study-option-body">
        <div class="study-option-text">${answer.textHtml}</div>
        ${answer.feedbackHtml ? `<div class="study-option-feedback">${answer.feedbackHtml}</div>` : ''}
      </div>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderTrueFalseBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-options';

  const correctAnswer = question.answers.find((a) => a.fraction > 0);
  const isTrueCorrect = correctAnswer && normalizeText(correctAnswer.textHtml) === 'true';

  const labels = [
    { label: 'Pravda', correct: !!isTrueCorrect },
    { label: 'Nepravda', correct: !isTrueCorrect },
  ];

  for (const item of labels) {
    const row = document.createElement('div');
    row.className = `study-option ${item.correct ? 'is-correct' : 'is-incorrect'}`;
    row.innerHTML = `
      <span class="study-mark" aria-hidden="true">${item.correct ? '✓' : '✗'}</span>
      <div class="study-option-body"><div class="study-option-text">${escapeHtml(item.label)}</div></div>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderShortAnswerBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-options';

  const accepted = question.answers.filter((a) => a.fraction > 0);
  for (const answer of accepted) {
    const row = document.createElement('div');
    row.className = 'study-option is-correct';
    row.innerHTML = `
      <span class="study-mark" aria-hidden="true">✓</span>
      <div class="study-option-body">
        <div class="study-option-text">${answer.textHtml}</div>
        ${answer.feedbackHtml ? `<div class="study-option-feedback">${answer.feedbackHtml}</div>` : ''}
      </div>
    `;
    wrap.appendChild(row);
  }

  const wrong = question.answers.filter((a) => a.fraction <= 0);
  for (const answer of wrong) {
    const row = document.createElement('div');
    row.className = 'study-option is-incorrect';
    row.innerHTML = `
      <span class="study-mark" aria-hidden="true">✗</span>
      <div class="study-option-body">
        <div class="study-option-text">${answer.textHtml}</div>
        ${answer.feedbackHtml ? `<div class="study-option-feedback">${answer.feedbackHtml}</div>` : ''}
      </div>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderMatchingBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-matching';

  for (const sub of question.subquestions) {
    const row = document.createElement('div');
    row.className = 'study-matching-row';
    row.innerHTML = `
      <div class="study-matching-prompt">${sub.promptHtml}</div>
      <div class="study-matching-arrow" aria-hidden="true">→</div>
      <div class="study-matching-answer">${escapeHtml(sub.answerText)}</div>
    `;
    wrap.appendChild(row);
  }
  return wrap;
}

function renderClozeBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-cloze';
  if (question.clozeBlanks && question.clozeBlanks.length) {
    const list = document.createElement('ol');
    list.className = 'study-cloze-list';
    for (const blank of question.clozeBlanks) {
      const li = document.createElement('li');
      const primary = blank.acceptedAnswers[0] || '';
      const alts = blank.acceptedAnswers.slice(1);
      li.innerHTML = `<strong>${escapeHtml(primary)}</strong>${alts.length ? `<span class="study-cloze-alts"> (nebo ${alts.map(escapeHtml).join(' / ')})</span>` : ''}`;
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }
  if (question.generalFeedbackHtml) {
    const note = document.createElement('div');
    note.className = 'study-explain';
    note.innerHTML = `<strong>Vysvětlení:</strong> ${question.generalFeedbackHtml}`;
    wrap.appendChild(note);
  }
  return wrap;
}

function renderEssayBody(question) {
  const wrap = document.createElement('div');
  wrap.className = 'study-essay';
  if (question.generalFeedbackHtml) {
    wrap.innerHTML = `<div class="study-essay-reference"><strong>Referenční opora:</strong>${question.generalFeedbackHtml}</div>`;
  } else {
    wrap.innerHTML = '<div class="study-essay-reference">Esejová otázka — bez automatické referenční odpovědi.</div>';
  }
  return wrap;
}

function shortSource(filePath) {
  return filePath.replace(/^questions\//, '').replace(/\.xml$/, '');
}

function showMessage(text, level) {
  els.messageBar.className = `message-bar card-surface ${level}`;
  els.messageBar.textContent = text;
  els.messageBar.classList.remove('hidden');
}

function hideMessage() {
  els.messageBar.classList.add('hidden');
}

function loadThemePreference() {
  applyTheme('auto');
  localStorage.setItem('7pos1-theme', 'auto');
}

function setupThemeDropdown() {
  if (!els.themeDropdown || !els.themeToggle) {
    return;
  }

  const menu = els.themeDropdown.querySelector('.theme-menu');
  const items = Array.from(els.themeDropdown.querySelectorAll('.theme-item'));
  const label = els.themeToggle.querySelector('.theme-label');
  const icon = els.themeToggle.querySelector('.theme-icon');

  els.themeToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = els.themeDropdown.classList.toggle('is-open');
    els.themeToggle.setAttribute('aria-expanded', String(isOpen));
  });

  items.forEach((item) => {
    item.addEventListener('click', () => {
      const mode = item.dataset.theme;
      applyTheme(mode);
      localStorage.setItem('7pos1-theme', mode);
      els.themeDropdown.classList.remove('is-open');
      els.themeToggle.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', (event) => {
    if (!els.themeDropdown.contains(event.target)) {
      els.themeDropdown.classList.remove('is-open');
      els.themeToggle.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      els.themeDropdown.classList.remove('is-open');
      els.themeToggle.setAttribute('aria-expanded', 'false');
    }
  });

  els.themeMenu = menu;
  els.themeItems = items;
  els.themeLabel = label;
  els.themeIcon = icon;
}

function applyTheme(theme) {
  const mode = theme === 'light' || theme === 'dark' || theme === 'auto' ? theme : 'auto';
  state.theme = mode;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;
  document.documentElement.dataset.theme = resolved;
  if (els.themeToggle) {
    els.themeToggle.dataset.theme = mode;
    const label = mode === 'dark' ? 'Tmavý motiv' : mode === 'light' ? 'Světlý motiv' : 'Automatický motiv';
    els.themeToggle.setAttribute('aria-label', label);
  }

  if (els.themeLabel && els.themeIcon) {
    const map = {
      light: { label: 'Světlý', icon: 'bi-brightness-high-fill' },
      auto: { label: 'Auto', icon: 'bi-circle-half' },
      dark: { label: 'Tmavý', icon: 'bi-moon-stars-fill' },
    };
    const current = map[mode] || map.auto;
    els.themeLabel.textContent = current.label;
    els.themeIcon.className = `bi ${current.icon} theme-icon`;
  }

  if (els.themeItems && els.themeItems.length) {
    els.themeItems.forEach((item) => {
      const isActive = item.dataset.theme === mode;
      item.classList.toggle('is-active', isActive);
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }
}

function getNodeText(node, selector) {
  const selected = node.querySelector(selector);
  return selected ? selected.textContent.trim() : '';
}

function stripHtml(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return stripHtml(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
