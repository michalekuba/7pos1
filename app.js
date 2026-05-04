const state = {
  questions: [],
  deck: [],
  index: 0,
  scored: 0,
  graded: 0,
  manual: 0,
  loadedFiles: [],
  currentQuestion: null,
  checked: false,
  theme: 'auto',
};

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

const els = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  bindEvents();
  setupThemeDropdown();
  loadThemePreference();
  // If page is opened via file:// the browser blocks fetch for local files.
  // Notify user and stop automatic loading to avoid confusing errors.
  if (window.location.protocol === 'file:') {
    // Friendly instructions for running a simple local server
    // Use PowerShell / cmd: python -m http.server 8000
    // or PowerShell (Windows): py -m http.server 8000
    // Then open http://localhost:8000/index.html
    alert('Pro správné načítání XML souborů spusťte jednoduchý lokální server v adresáři projektu, např. v PowerShellu: \n\npy -m http.server 8000\n\nPak otevřete v prohlížeči: http://localhost:8000/index.html');
    console.log('Running from file:// — fetching XML files is blocked. Start a local server: py -m http.server 8000');
    return;
  }

  loadQuestions();
  // expose for debugging/testing in the browser automation
  try {
    window.__state = state;
    window.__renderCurrentQuestion = renderCurrentQuestion;
  } catch (e) {
    // ignore
  }
}

function cacheElements() {
  els.themeToggle = document.getElementById('themeToggle');
  els.themeDropdown = document.querySelector('.theme-dropdown');
  els.quizShell = document.getElementById('quizShell');
  els.summaryShell = document.getElementById('summaryShell');
  els.messageBar = document.getElementById('messageBar');
  els.questionText = document.getElementById('questionText');
  els.answerArea = document.getElementById('answerArea');
  els.feedbackArea = document.getElementById('feedbackArea');
  els.checkButton = document.getElementById('checkButton');
  els.nextButton = document.getElementById('nextButton');
  els.progressFill = document.getElementById('progressFill');
  els.progressLabel = document.getElementById('progressLabel');
}

function bindEvents() {
  els.checkButton.addEventListener('click', checkCurrentAnswer);
  els.nextButton.addEventListener('click', goToNextQuestion);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'auto') {
      applyTheme('auto');
    }
  });
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

async function loadQuestions() {
  showMessage('Načítám otázky...', 'warning');
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
      showMessage(`Nepodařilo se načíst ${filePath}: ${error.message}`, 'error');
      continue;
    }
  }

  state.loadedFiles = QUESTION_FILES.slice();
  state.questions = dedupeQuestions(parsed);
  updateCounters();

  if (!state.questions.length) {
    showMessage('Nepodařilo se načíst žádné otázky. Zkontroluj, že stránka běží z webhostingu a XML soubory jsou dostupné.', 'error');
    return;
  }

  showMessage(`Načteno ${state.questions.length} unikátních otázek z ${state.loadedFiles.length} souborů.`, 'success');
  startQuiz();
}

function parseQuizXml(xmlText, sourceFile) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('soubor nemá platný XML formát');
  }

  const questions = [];
  let currentCategory = '';

  for (const node of Array.from(doc.documentElement.children || [])) {
    if (node.tagName !== 'question') {
      continue;
    }

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

    if (type === 'multichoice') {
      question.single = getNodeText(node, 'single').trim().toLowerCase() === 'true';
      question.shuffleAnswers = getNodeText(node, 'shuffleanswers').trim().toLowerCase() !== 'false';
      question.answers = Array.from(node.children)
        .filter((child) => child.tagName === 'answer')
        .map((answerNode, index) => ({
          index,
          fraction: Number(answerNode.getAttribute('fraction') || 0),
          textHtml: getNodeText(answerNode, 'text'),
          feedbackHtml: getNodeText(answerNode, 'feedback > text'),
        }));
    } else if (type === 'truefalse') {
      question.answers = Array.from(node.children)
        .filter((child) => child.tagName === 'answer')
        .map((answerNode, index) => ({
          index,
          fraction: Number(answerNode.getAttribute('fraction') || 0),
          textHtml: getNodeText(answerNode, 'text'),
          feedbackHtml: getNodeText(answerNode, 'feedback > text'),
        }));
    } else if (type === 'shortanswer') {
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

    renderedHtml += `<span class="cloze-embed"><input class="cloze-input" type="text" autocomplete="off" data-blank-index="${blankIndex}" aria-label="Doplňovací pole ${blankIndex + 1}"></span>`;
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

function startQuiz() {
  if (!state.questions.length) {
    showMessage('Otázky zatím nejsou načtené.', 'error');
    return;
  }

  state.deck = buildDeck(state.questions);
  if (!state.deck.length) {
    showMessage('Z načtených souborů se nepodařilo sestavit test.', 'error');
    return;
  }

  state.index = 0;
  state.scored = 0;
  state.graded = 0;
  state.manual = 0;
  state.currentQuestion = null;
  state.checked = false;

  els.quizShell.classList.remove('hidden');
  els.summaryShell.classList.add('hidden');

  renderCurrentQuestion();
  updateCounters();
}

function buildDeck(questions) {
  const bankQuestions = questions.filter((question) => isBankFile(question.sourceFile));
  if (bankQuestions.length) {
    return buildBankExamDeck(bankQuestions);
  }

  return buildFallbackExamDeck(questions);
}

function buildBankExamDeck(bankQuestions) {
  const byCategory = groupBy(bankQuestions, (question) => question.categoryPath || '');
  const deck = [];

  const shortCategories = Object.keys(byCategory).filter((path) => /\/Krátké$/i.test(path));
  const pairCategories = Object.keys(byCategory).filter((path) => /\/Přiřazování-Doplňování$/i.test(path));
  const essayBankCategory = Object.keys(byCategory).find((path) => /Esejový bank/i.test(path));
  const essayPool = essayBankCategory ? byCategory[essayBankCategory].filter((question) => question.type === 'essay') : bankQuestions.filter((question) => question.type === 'essay');

  for (const categoryPath of shortCategories.sort()) {
    deck.push(...pickRandom(byCategory[categoryPath], 3));
  }

  for (const categoryPath of pairCategories.sort()) {
    deck.push(...pickRandom(byCategory[categoryPath], 1));
  }

  deck.push(...pickRandom(essayPool, 2));
  return shuffleArray(deck);
}

function buildFallbackExamDeck(questions) {
  const byLecture = groupBy(questions, (question) => extractLectureKey(question));
  const deck = [];

  for (const lectureKey of Object.keys(byLecture).sort()) {
    const lectureQuestions = byLecture[lectureKey];
    const shortPool = lectureQuestions.filter(isShortQuestion);
    const pairPool = lectureQuestions.filter(isPairQuestion);

    deck.push(...pickRandom(shortPool, 3));
    deck.push(...pickRandom(pairPool, 1));
  }

  const essayPool = questions.filter((question) => question.type === 'essay');
  deck.push(...pickRandom(essayPool, 2));
  return shuffleArray(deck);
}

function extractLectureKey(question) {
  const sourceMatch = question.sourceFile.match(/test_prednaska(\d+)/i);
  if (sourceMatch) {
    return `P${sourceMatch[1]}`;
  }

  const categoryMatch = question.categoryPath.match(/Přednáška\s+(\d+)/i);
  if (categoryMatch) {
    return `P${categoryMatch[1]}`;
  }

  return question.sourceFile;
}

function isShortQuestion(question) {
  return ['multichoice', 'truefalse', 'shortanswer'].includes(question.type);
}

function isPairQuestion(question) {
  return ['matching', 'cloze'].includes(question.type);
}

function renderCurrentQuestion() {
  const question = state.deck[state.index];
  state.currentQuestion = question;
  state.checked = false;

  els.summaryShell.classList.add('hidden');
  els.quizShell.classList.remove('hidden');
  els.feedbackArea.innerHTML = '';
  els.answerArea.innerHTML = '';
  els.questionText.innerHTML = question.questionTextHtml || '';

  renderAnswerControls(question);
  els.checkButton.disabled = false;
  els.nextButton.disabled = true;

  updateProgress();
}

function renderAnswerControls(question) {
  if (question.type === 'multichoice') {
    renderMultichoice(question);
    return;
  }

  if (question.type === 'truefalse') {
    renderTrueFalse(question);
    return;
  }

  if (question.type === 'shortanswer') {
    renderShortAnswer(question);
    return;
  }

  if (question.type === 'matching') {
    renderMatching(question);
    return;
  }

  if (question.type === 'cloze') {
    els.answerArea.innerHTML = '<p class="help-text">Doplň odpovědi přímo do textu výše a potom klikni na kontrolu.</p>';
    return;
  }

  if (question.type === 'essay') {
    renderEssay(question);
    return;
  }

  els.answerArea.innerHTML = '<p class="help-text">Tento typ otázky není v aplikaci zatím podporovaný.</p>';
}

function renderMultichoice(question) {
  const options = question.shuffleAnswers ? shuffleArray([...question.answers]) : [...question.answers];
  const list = document.createElement('div');
  list.className = 'option-list';

  const inputName = `multichoice-${state.index}`;
  const inputType = question.single ? 'radio' : 'checkbox';

  options.forEach((answer) => {
    const label = document.createElement('label');
    label.className = 'option-item';

    const input = document.createElement('input');
    input.type = inputType;
    input.name = inputName;
    input.value = String(answer.index);

    const text = document.createElement('span');
    text.innerHTML = answer.textHtml;

    label.append(input, text);
    list.appendChild(label);
  });

  els.answerArea.appendChild(list);
}

function renderTrueFalse(question) {
  const trueAnswer = question.answers.find((answer) => normalizeText(answer.textHtml) === 'true');
  const falseAnswer = question.answers.find((answer) => normalizeText(answer.textHtml) === 'false');
  const options = [
    { index: trueAnswer?.index ?? 0, label: 'Pravda' },
    { index: falseAnswer?.index ?? 1, label: 'Nepravda' },
  ];
  const list = document.createElement('div');
  list.className = 'option-list';

  options.forEach((option) => {
    const label = document.createElement('label');
    label.className = 'option-item';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `truefalse-${state.index}`;
    input.value = String(option.index);

    const text = document.createElement('span');
    text.textContent = option.label;

    label.append(input, text);
    list.appendChild(label);
  });

  els.answerArea.appendChild(list);
}

function renderShortAnswer(question) {
  const wrapper = document.createElement('div');
  wrapper.className = 'answer-group';
  wrapper.innerHTML = `
    <label for="shortInput">Napiš odpověď</label>
    <input id="shortInput" class="shortanswer-input" type="text" autocomplete="off" placeholder="Zadej krátkou odpověď">
  `;
  els.answerArea.appendChild(wrapper);
}

function renderMatching(question) {
  const wrapper = document.createElement('div');
  wrapper.className = 'matching-grid';
  const answerPool = shuffleArray(question.subquestions.map((subquestion) => subquestion.answerText));

  question.subquestions.forEach((subquestion) => {
    const row = document.createElement('div');
    row.className = 'matching-row';

    const prompt = document.createElement('div');
    prompt.className = 'matching-prompt';
    prompt.innerHTML = subquestion.promptHtml;

    const select = document.createElement('select');
    select.innerHTML = '<option value="">Vyber odpověď</option>';

    answerPool.forEach((answerText) => {
      const option = document.createElement('option');
      option.value = answerText;
      option.textContent = answerText;
      select.appendChild(option);
    });

    row.append(prompt, select);
    wrapper.appendChild(row);
  });

  els.answerArea.appendChild(wrapper);
}

function renderEssay(question) {
  const wrapper = document.createElement('div');
  wrapper.className = 'answer-group';
  wrapper.innerHTML = `
    <label for="essayInput">Napiš esejovou odpověď</label>
    <textarea id="essayInput" class="essay-input" placeholder="Esej je v této verzi hodnocena ručně."></textarea>
  `;

  els.answerArea.appendChild(wrapper);
}

function checkCurrentAnswer() {
  if (!state.currentQuestion || state.checked) {
    return;
  }

  const result = evaluateCurrentQuestion(state.currentQuestion);
  state.checked = true;

  if (result.gradeable) {
    state.graded += 1;
    if (result.correct) {
      state.scored += 1;
    }
  } else {
    state.manual += 1;
  }

  renderFeedback(result);
  els.checkButton.disabled = true;
  els.nextButton.disabled = false;
  disableCurrentInputs();
  updateCounters();
}

function evaluateCurrentQuestion(question) {
  if (question.type === 'multichoice') {
    return evaluateMultichoice(question);
  }

  if (question.type === 'truefalse') {
    return evaluateTrueFalse(question);
  }

  if (question.type === 'shortanswer') {
    return evaluateShortAnswer(question);
  }

  if (question.type === 'matching') {
    return evaluateMatching(question);
  }

  if (question.type === 'cloze') {
    return evaluateCloze(question);
  }

  if (question.type === 'essay') {
    return evaluateEssay(question);
  }

  return {
    gradeable: false,
    correct: false,
    title: 'Nepodporovaný typ',
    messageHtml: '<p>Tento typ otázky aplikace zatím neumí automaticky vyhodnotit.</p>',
  };
}

function evaluateMultichoice(question) {
  const selected = Array.from(els.answerArea.querySelectorAll(`input[name="multichoice-${state.index}"]`))
    .filter((input) => input.checked)
    .map((input) => Number(input.value))
    .sort((a, b) => a - b);
  const correct = question.answers
    .filter((answer) => answer.fraction > 0)
    .map((answer) => answer.index)
    .sort((a, b) => a - b);
  const correctAnswerHtml = formatAnswerList(question.answers.filter((answer) => answer.fraction > 0).map((answer) => answer.textHtml));
  const selectedAnswers = question.answers.filter((answer) => selected.includes(answer.index));
  const correctMatch = arraysEqual(selected, correct);

  return {
    gradeable: true,
    correct: correctMatch,
    title: correctMatch ? 'Správně' : 'Nesprávně',
    messageHtml: correctMatch
      ? `<p>${question.generalFeedbackHtml || 'Odpověď je správně.'}</p>`
      : `<p>Správné odpovědi: ${correctAnswerHtml}</p>${question.generalFeedbackHtml ? `<p>${question.generalFeedbackHtml}</p>` : ''}`,
    detailHtml: selectedAnswers.length ? `<p>Tvoje volba: ${formatAnswerList(selectedAnswers.map((answer) => answer.textHtml))}</p>` : '<p>Nevybral jsi žádnou odpověď.</p>',
  };
}

function evaluateTrueFalse(question) {
  const selected = els.answerArea.querySelector(`input[name="truefalse-${state.index}"]:checked`);
  const correctAnswer = question.answers.find((answer) => answer.fraction > 0);
  const correctIndex = correctAnswer ? String(correctAnswer.index) : '0';
  const correct = selected ? selected.value === correctIndex : false;
  const correctLabel = normalizeText(correctAnswer?.textHtml) === 'true' ? 'Pravda' : 'Nepravda';

  return {
    gradeable: true,
    correct,
    title: correct ? 'Správně' : 'Nesprávně',
    messageHtml: correct
      ? `<p>${question.generalFeedbackHtml || 'Odpověď je správně.'}</p>`
      : `<p>Správná odpověď je ${correctLabel}.</p>${question.generalFeedbackHtml ? `<p>${question.generalFeedbackHtml}</p>` : ''}`,
  };
}

function evaluateShortAnswer(question) {
  const value = document.getElementById('shortInput')?.value || '';
  const normalized = normalizeKey(value);
  const accepted = question.answers.filter((answer) => answer.fraction > 0).map((answer) => normalizeKey(answer.textHtml));
  const correctAnswerHtml = formatAnswerList(question.answers.filter((answer) => answer.fraction > 0).map((answer) => answer.textHtml));
  const correct = accepted.includes(normalized);

  return {
    gradeable: true,
    correct,
    title: correct ? 'Správně' : 'Nesprávně',
    messageHtml: correct
      ? `<p>${question.generalFeedbackHtml || 'Odpověď je správně.'}</p>`
      : `<p>Očekávaná odpověď: ${correctAnswerHtml}</p>${question.generalFeedbackHtml ? `<p>${question.generalFeedbackHtml}</p>` : ''}`,
  };
}

function evaluateMatching(question) {
  const selects = Array.from(els.answerArea.querySelectorAll('select'));
  const correctAnswers = question.subquestions.map((subquestion) => normalizeKey(subquestion.answerText));
  const selectedAnswers = selects.map((select) => normalizeKey(select.value));
  const correct = selectedAnswers.length === correctAnswers.length && selectedAnswers.every((value, index) => value === correctAnswers[index]);
  return {
    gradeable: true,
    correct,
    title: correct ? 'Správně' : 'Nesprávně',
    // Avoid appending full general feedback here (it may contain extra items like URG)
    messageHtml: correct
      ? `<p>${question.generalFeedbackHtml || 'Přiřazení je správně.'}</p>`
      : `<p>Správné přiřazení:</p><ul>${question.subquestions.map((subquestion) => `<li>${subquestion.promptHtml} → ${escapeHtml(subquestion.answerText)}</li>`).join('')}</ul>`,
  };
}

function evaluateCloze(question) {
  const inputs = Array.from(els.questionText.querySelectorAll('.cloze-input'));
  const results = inputs.map((input, index) => {
    const blank = question.clozeBlanks[index];
    const normalized = normalizeKey(input.value);
    const accepted = blank.acceptedAnswers.map((answer) => normalizeKey(answer));
    return accepted.includes(normalized);
  });
  const correct = results.every(Boolean);
  const solutionHtml = question.clozeBlanks
    .map((blank) => `<li>${blank.acceptedAnswers.map((answer) => escapeHtml(answer)).join(' / ')}</li>`)
    .join('');

  return {
    gradeable: true,
    correct,
    title: correct ? 'Správně' : 'Nesprávně',
    messageHtml: correct
      ? `<p>${question.generalFeedbackHtml || 'Doplňovačka je správně.'}</p>`
      : `<p>Správné doplnění:</p><ul>${solutionHtml}</ul>${question.generalFeedbackHtml ? `<p>${question.generalFeedbackHtml}</p>` : ''}`,
  };
}

function evaluateEssay(question) {
  const text = document.getElementById('essayInput')?.value.trim() || '';
  return {
    gradeable: false,
    correct: false,
    title: text ? 'Esej uložena' : 'Esej bez odpovědi',
    messageHtml: `<p>Esej nelze automaticky vyhodnotit. Porovnej svou odpověď s referencí níže.</p>${question.generalFeedbackHtml ? `<div class="feedback-box warning"><h3>Referenční opora</h3>${question.generalFeedbackHtml}</div>` : ''}`,
  };
}

function renderFeedback(result) {
  const box = document.createElement('div');
  box.className = `feedback-box ${result.correct ? 'success' : result.gradeable ? 'error' : 'warning'}`;
  box.innerHTML = `<h3>${escapeHtml(result.title)}</h3>${result.detailHtml || ''}${result.messageHtml || ''}`;
  els.feedbackArea.innerHTML = '';
  els.feedbackArea.appendChild(box);
}

function disableCurrentInputs() {
  const inputs = els.answerArea.querySelectorAll('input, select, textarea, button');
  inputs.forEach((input) => {
    input.disabled = true;
  });
  const clozeInputs = els.questionText.querySelectorAll('.cloze-input');
  clozeInputs.forEach((input) => {
    input.disabled = true;
  });
}

function goToNextQuestion() {
  if (state.index + 1 >= state.deck.length) {
    renderSummary();
    return;
  }

  state.index += 1;
  renderCurrentQuestion();
}

function renderSummary() {
  els.quizShell.classList.add('hidden');
  els.summaryShell.classList.remove('hidden');

  const accuracy = state.graded ? Math.round((state.scored / state.graded) * 100) : 0;
  els.summaryShell.innerHTML = `
    <p class="eyebrow">Hotovo</p>
    <h2>Test je dokončen</h2>
    <p>Vyhodnoceno bylo ${state.graded} otázek. Eseje se neevalují automaticky a jsou vedené jako ruční kontrola.</p>
    <div class="summary-grid">
      <div class="summary-card"><span>Úspěšnost</span><strong>${accuracy}%</strong></div>
      <div class="summary-card"><span>Správně</span><strong>${state.scored}</strong></div>
      <div class="summary-card"><span>Ruční kontrola</span><strong>${state.manual}</strong></div>
    </div>
    <div class="summary-actions">
      <button class="button primary" type="button" id="summaryRestart">Spustit znovu</button>
    </div>
  `;

  document.getElementById('summaryRestart').addEventListener('click', startQuiz);
}

function updateCounters() {
  // Counters panel removed from UI; keep progress updated instead
  updateProgress();
}

function updateProgress() {
  const total = state.deck.length || 1;
  const current = state.index + 1;
  const percent = Math.round((current / total) * 100);
  els.progressFill.style.width = `${percent}%`;
  els.progressLabel.textContent = `${current}/${state.deck.length} otázek`;
}

function showMessage(text, level = 'warning') {
  if (els.messageBar) {
    els.messageBar.className = `message-bar card-surface ${level}`;
    els.messageBar.textContent = text;
    els.messageBar.classList.remove('hidden');
  } else {
    // message bar removed from UI; fallback to console for debugging
    // keep short visible logs for user/developer
    console.log(`[${level}] ${text}`);
  }
}

function loadThemePreference() {
  const savedTheme = localStorage.getItem('7pos1-theme');
  const mode = savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto' ? savedTheme : 'auto';
  applyTheme(mode);
}

function applyTheme(theme) {
  const mode = theme === 'light' || theme === 'dark' || theme === 'auto' ? theme : 'auto';
  state.theme = mode;
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolvedTheme = mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode;

  root.dataset.theme = resolvedTheme;
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

function formatQuestionMeta(question) {
  const parts = [];
  if (question.categoryPath) {
    parts.push(stripCoursePrefix(question.categoryPath));
  }
  if (question.type) {
    parts.push(question.type);
  }
  if (question.sourceFile) {
    parts.push(question.sourceFile);
  }
  return parts.join(' · ');
}

function stripCoursePrefix(value) {
  return value.replace(/^\$course\$\//, '');
}

function getNodeText(node, selector) {
  const selected = node.querySelector(selector);
  return selected ? selected.textContent.trim() : '';
}

function stripHtml(html) {
  if (!html) {
    return '';
  }

  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return stripHtml(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalizeText(value);
}

function arraysEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function formatAnswerList(values) {
  return values.map((value) => escapeHtml(stripHtml(value))).join(', ');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shuffleArray(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function pickRandom(values, count) {
  return shuffleArray(values).slice(0, Math.min(count, values.length));
}

function groupBy(values, getKey) {
  return values.reduce((groups, value) => {
    const key = getKey(value);
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(value);
    return groups;
  }, {});
}