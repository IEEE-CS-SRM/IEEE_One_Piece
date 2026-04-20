// ╔══════════════════════════════════════════════════════════╗
// ║       ONE PIECE — CHARACTER KNOWLEDGE TRIAL              ║
// ╚══════════════════════════════════════════════════════════╝

const QUESTION_BANK = Array.isArray(window.ONE_PIECE_QUESTION_BANK)
  ? window.ONE_PIECE_QUESTION_BANK
  : [];
const TOTAL_QUESTIONS = 10;
const ANSWER_LETTERS = ['A', 'B', 'C', 'D'];
const CHARACTER_LOOKUP = buildCharacterLookup(QUESTION_BANK);
const AVAILABLE_CHARACTER_NAMES = QUESTION_BANK.map((entry) => entry.name);

// ─── Coupon Table ─────────────────────────────────────────
const COUPONS = [
  { min: 10, max: 10, code: 'TOP40', discount: '₹99 off',  label: 'LEGENDARY TREASURE — PERFECT SCORE!' },
  { min: 9,  max: 9,  code: '50OFF', discount: '₹50 off',  label: 'YONKO WORTHY'                        },
  { min: 7,  max: 8,  code: '40OFF', discount: '₹40 off',  label: 'ELITE CREW MEMBER'                   },
  { min: 5,  max: 6,  code: '30OFF', discount: '₹30 off',  label: 'NAKAMA APPROVED'                     },
  { min: 3,  max: 4,  code: '20OFF', discount: '₹20 off',  label: 'STRAW HAT RECRUIT'                   },
  { min: 1,  max: 2,  code: '10OFF', discount: '₹10 off',  label: 'EAST BLUE ROOKIE'                    },
];

function getCoupon(score) {
  return COUPONS.find(c => score >= c.min && score <= c.max) || null;
}

function normalizeLookupValue(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildCharacterLookup(bank) {
  const lookup = new Map();

  bank.forEach((entry) => {
    const aliases = [entry.key, entry.name, ...(entry.aliases || [])];
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeLookupValue(alias);
      if (normalizedAlias) {
        lookup.set(normalizedAlias, entry);
      }
    });
  });

  return lookup;
}

function shuffleArray(items) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function stripOptionPrefix(option) {
  return String(option).replace(/^[A-D]\.\s*/, '');
}

function normalizeQuestion(question, index) {
  const options = Array.isArray(question.options) ? question.options.slice(0, 4) : [];
  const answer = String(question.answer || 'A').toUpperCase().charAt(0);

  if (options.length !== 4 || !ANSWER_LETTERS.includes(answer)) {
    throw new Error(`Question bank entry ${index + 1} is malformed.`);
  }

  const plainOptions = options.map((option) => stripOptionPrefix(option));
  const correctOptionIndex = ANSWER_LETTERS.indexOf(answer);
  const shuffledOptions = shuffleArray(
    plainOptions.map((optionText, optionIndex) => ({
      optionText,
      isCorrect: optionIndex === correctOptionIndex,
    }))
  );
  const shuffledAnswerIndex = shuffledOptions.findIndex((option) => option.isCorrect);

  return {
    question: question.question || `Question ${index + 1}`,
    options: shuffledOptions.map((option, optionIndex) =>
      `${ANSWER_LETTERS[optionIndex]}. ${option.optionText}`
    ),
    answer: ANSWER_LETTERS[shuffledAnswerIndex],
  };
}

function resolveCharacterDeck(characterName) {
  if (!QUESTION_BANK.length) {
    throw new Error('Static question bank failed to load. Reload the quiz page once.');
  }

  const normalizedName = normalizeLookupValue(characterName);
  const exactMatch = CHARACTER_LOOKUP.get(normalizedName);
  if (exactMatch) return exactMatch;

  const partialMatch = QUESTION_BANK.find((entry) => {
    const aliases = [entry.key, entry.name, ...(entry.aliases || [])];
    return aliases.some((alias) => {
      const normalizedAlias = normalizeLookupValue(alias);
      return normalizedAlias.includes(normalizedName) || normalizedName.includes(normalizedAlias);
    });
  });

  if (partialMatch) return partialMatch;

  throw new Error(
    `No preloaded deck found for "${characterName}". Try: ${AVAILABLE_CHARACTER_NAMES.join(', ')}.`
  );
}

// ─── State ────────────────────────────────────────────────
let state = {
  characterName: '',
  questions: [],
  userAnswers: {},   // { qi: 'A'|'B'|'C'|'D' }
  score: 0,
  currentQ: 0,
  submitted: false,
};
let submitPending = false;
let submitPendingTimeoutId = 0;
let resultScoreIntervalId = 0;
let resultRingTimeoutId = 0;
let toastTimeoutId = 0;

// ─── Views ────────────────────────────────────────────────
const VIEWS = {
  home:    document.getElementById('view-home'),
  loading: document.getElementById('view-loading'),
  quiz:    document.getElementById('view-quiz'),
  results: document.getElementById('view-results'),
};
const oceanBg = document.getElementById('ocean-bg');

function showView(name) {
  Object.values(VIEWS).forEach(v => v.classList.remove('active'));
  VIEWS[name].classList.add('active');
  // Show/hide ocean bg (home has its own hero bg)
  oceanBg.style.display = name === 'home' ? 'none' : 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetSubmitWarning() {
  submitPending = false;
  clearTimeout(submitPendingTimeoutId);
  submitPendingTimeoutId = 0;
  document.getElementById('unanswered-warning').style.display = 'none';
}

function resetReviewSection() {
  const reviewSection = document.getElementById('review-section');
  const reviewButton = document.getElementById('toggle-review-btn');

  reviewSection.classList.remove('open');
  reviewButton.textContent = 'Review Answers ▼';
  reviewButton.setAttribute('aria-expanded', 'false');
}

function resetResultView() {
  clearInterval(resultScoreIntervalId);
  clearTimeout(resultRingTimeoutId);
  resultScoreIntervalId = 0;
  resultRingTimeoutId = 0;
  document.getElementById('score-num').textContent = '0';
  document.getElementById('score-ring').style.background =
    'conic-gradient(var(--gold) 0deg, rgba(245,197,24,0.08) 0deg)';
  document.getElementById('review-list').textContent = '';
  resetReviewSection();
}

function resetQuizState(characterName = '') {
  state = {
    characterName,
    questions: [],
    userAnswers: {},
    score: 0,
    currentQ: 0,
    submitted: false,
  };

  resetSubmitWarning();
  resetResultView();
}

// ─── Background Particles & Stars ─────────────────────────
function initBg() {
  const starsEl = document.getElementById('stars-el');
  for (let i = 0; i < 100; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const sz = Math.random() * 2.5 + 0.5;
    s.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random()*100}%;top:${Math.random()*75}%;--dur:${2+Math.random()*4}s;animation-delay:${Math.random()*5}s;`;
    starsEl.appendChild(s);
  }
  const partEl = document.getElementById('particles-el');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const sz = Math.random() * 4 + 2;
    p.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random()*100}%;bottom:${Math.random()*50}%;--dur:${5+Math.random()*8}s;--delay:${Math.random()*7}s;`;
    partEl.appendChild(p);
  }
}

// ─── Home Form ────────────────────────────────────────────
const homeForm = document.getElementById('home-form');
const charInput = document.getElementById('character-input');
const startBtn  = document.getElementById('start-btn');
const homeError = document.getElementById('home-error');

function populateCharacterSelect() {
  charInput.innerHTML = '<option value="">Select a character...</option>';

  AVAILABLE_CHARACTER_NAMES.forEach((characterName) => {
    const option = document.createElement('option');
    option.value = characterName;
    option.textContent = characterName;
    charInput.appendChild(option);
  });
}

homeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = charInput.value.trim();
  if (!name) { charInput.focus(); return; }

  resetQuizState(name);
  homeError.style.display = 'none';
  startBtn.disabled = true;
  startBtn.textContent = '⏳  Setting Sail…';

  document.getElementById('loading-char').textContent = `"${name}"`;
  showView('loading');

  try {
    const quizData = generateQuestions(name);
    state.characterName = quizData.characterName;
    state.questions = quizData.questions;
    renderQuiz();
    showView('quiz');
  } catch (err) {
    console.error(err);
    showView('home');
    homeError.textContent = `⚠️ ${err.message || 'Failed to load the question deck. Try another supported character.'}`;
    homeError.style.display = 'block';
  } finally {
    startBtn.disabled = false;
    startBtn.innerHTML = '⚓ &nbsp;Set Sail — Start Quiz';
  }
});

// ─── Static Question Bank ─────────────────────────────────
function generateQuestions(character) {
  const deck = resolveCharacterDeck(character);
  const questions = shuffleArray(deck.questions)
    .slice(0, TOTAL_QUESTIONS)
    .map((question, index) => normalizeQuestion(question, index));

  if (questions.length !== TOTAL_QUESTIONS) {
    throw new Error(`"${deck.name}" does not yet have a full 10-question deck.`);
  }

  return {
    characterName: deck.name,
    questions,
  };
}

// ─── Quiz: Render ─────────────────────────────────────────
function renderQuiz() {
  document.getElementById('quiz-char-badge').textContent = `⚔️ ${state.characterName}`;
  state.currentQ = 0;
  buildDots();
  showQuestion(0, 'right');
  updateNav();
  updateSubmitWrap();
}

function buildDots() {
  const nav = document.getElementById('dots-nav');
  nav.innerHTML = '';
  for (let i = 0; i < state.questions.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'q-dot';
    btn.id = `dot-${i}`;
    btn.textContent = i + 1;
    btn.setAttribute('aria-label', `Go to question ${i + 1}`);
    btn.addEventListener('click', () => jumpTo(i));
    nav.appendChild(btn);
  }
  refreshDots();
}

function refreshDots() {
  state.questions.forEach((_, i) => {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) return;
    dot.className = 'q-dot' +
      (i === state.currentQ ? ' current' : '') +
      (state.userAnswers[i] ? ' answered' : '');
  });
  // Update live count
  const answered = Object.keys(state.userAnswers).length;
  document.getElementById('live-answered').textContent = answered;
}

function createOptionButton(qi, letter, optionText) {
  const optionLabel = stripOptionPrefix(optionText);
  const isSelected = state.userAnswers[qi] === letter;
  const button = document.createElement('button');
  const optionLetter = document.createElement('span');
  const optionTextSpan = document.createElement('span');

  button.type = 'button';
  button.className = 'option-btn';
  button.id = `opt-${qi}-${letter}`;
  button.dataset.qi = String(qi);
  button.dataset.letter = letter;
  button.setAttribute('aria-label', `Option ${letter}: ${optionLabel}`);

  if (isSelected) {
    button.classList.add('selected');
  }

  if (state.submitted) {
    button.disabled = true;

    if (letter === state.questions[qi].answer) {
      button.classList.add('correct');
    } else if (isSelected) {
      button.classList.add('wrong');
    }
  }

  button.addEventListener('click', () => selectOption(qi, letter, button));

  optionLetter.className = 'opt-letter';
  optionLetter.textContent = letter;
  optionTextSpan.textContent = optionLabel;

  button.append(optionLetter, optionTextSpan);

  return button;
}

function createQuestionCard(qi, q, dir) {
  const card = document.createElement('div');
  const number = document.createElement('div');
  const text = document.createElement('div');
  const optionsList = document.createElement('div');

  card.className = `question-card slide-enter-${dir}`;
  number.className = 'q-number';
  text.className = 'q-text';
  optionsList.className = 'options-list';
  optionsList.id = `opts-${qi}`;

  number.textContent = `Question ${qi + 1} of ${TOTAL_QUESTIONS}`;
  text.textContent = q.question;

  q.options.forEach((optionText, optionIndex) => {
    optionsList.appendChild(createOptionButton(qi, ANSWER_LETTERS[optionIndex], optionText));
  });

  card.append(number, text, optionsList);

  return card;
}

function showQuestion(qi, dir = 'right') {
  const wrap = document.getElementById('q-slide-wrap');
  const q = state.questions[qi];
  if (!q) return;

  const card = createQuestionCard(qi, q, dir);

  // Remove old card with exit animation
  const old = wrap.querySelector('.question-card');
  if (old) {
    old.classList.add(`slide-exit-${dir === 'right' ? 'left' : 'right'}`);
    setTimeout(() => old.remove(), 300);
  }
  wrap.appendChild(card);

  // Update nav counter
  document.getElementById('nav-counter').textContent = `Q ${qi + 1} of ${TOTAL_QUESTIONS}`;
}

function jumpTo(qi) {
  if (qi === state.currentQ) return;
  const dir = qi > state.currentQ ? 'right' : 'left';
  state.currentQ = qi;
  showQuestion(qi, dir);
  updateNav();
  updateSubmitWrap();
  refreshDots();
}

// Global navigation (called by buttons)
function goNext() {
  if (state.currentQ < state.questions.length - 1) jumpTo(state.currentQ + 1);
}
function goPrev() {
  if (state.currentQ > 0) jumpTo(state.currentQ - 1);
}

function updateNav() {
  document.getElementById('prev-btn').disabled = state.currentQ === 0;
  document.getElementById('next-btn').disabled = state.currentQ === state.questions.length - 1;
}

function updateSubmitWrap() {
  // Always show submit wrap; button text changes based on position
  const btn = document.getElementById('submit-quiz-btn');
  const isLast = state.currentQ === state.questions.length - 1;
  btn.style.opacity = isLast ? '1' : '0.55';
  btn.title = isLast ? '' : 'Navigate to the last question to submit, or click to submit early.';
}

// Select an option
function selectOption(qi, letter, btn) {
  if (state.submitted) return;
  // Deselect all in this question
  ANSWER_LETTERS.forEach(l => {
    const b = document.getElementById(`opt-${qi}-${l}`);
    if (b) b.classList.remove('selected');
  });
  btn.classList.add('selected');
  state.userAnswers[qi] = letter;
  refreshDots();
  updateSubmitWrap();
}

// Keyboard support
document.addEventListener('keydown', (e) => {
  if (VIEWS.quiz.classList.contains('active') && !state.submitted) {
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); goPrev(); }
    if (['1','2','3','4'].includes(e.key)) {
      e.preventDefault();
      const letter  = ANSWER_LETTERS[parseInt(e.key, 10) - 1];
      const btn = document.getElementById(`opt-${state.currentQ}-${letter}`);
      if (btn) selectOption(state.currentQ, letter, btn);
    }
  }
});

// Prev / Next buttons
document.getElementById('prev-btn').addEventListener('click', goPrev);
document.getElementById('next-btn').addEventListener('click', goNext);

// ─── Quiz: Submit ─────────────────────────────────────────
document.getElementById('submit-quiz-btn').addEventListener('click', () => {
  const answered = Object.keys(state.userAnswers).length;
  const warn = document.getElementById('unanswered-warning');

  if (answered < TOTAL_QUESTIONS && !submitPending) {
    const missing = TOTAL_QUESTIONS - answered;
    warn.style.display = 'block';
    warn.textContent = `⚠️ ${missing} question(s) unanswered. Click again to submit anyway.`;
    submitPending = true;
    clearTimeout(submitPendingTimeoutId);
    submitPendingTimeoutId = setTimeout(() => {
      resetSubmitWarning();
    }, 4000);
    return;
  }

  resetSubmitWarning();
  finalizeQuiz();
});

function finalizeQuiz() {
  state.submitted = true;

  // Mark all answers visually on current question and everywhere
  state.questions.forEach((q, qi) => {
    ANSWER_LETTERS.forEach((letter) => {
      const btn = document.getElementById(`opt-${qi}-${letter}`);
      if (!btn) return;
      btn.disabled = true;
      btn.classList.remove('selected');
      if (letter === q.answer)                        btn.classList.add('correct');
      else if (letter === state.userAnswers[qi])      btn.classList.add('wrong');
    });
  });

  // Calculate score
  state.score = state.questions.reduce(
    (acc, q, qi) => acc + (state.userAnswers[qi] === q.answer ? 1 : 0), 0
  );

  setTimeout(() => {
    renderResults();
    showView('results');
    if (state.score >= 7) launchConfetti();
  }, 600);
}

// ─── Results ──────────────────────────────────────────────
function renderResults() {
  const score  = state.score;
  const coupon = getCoupon(score);
  const scoreRing = document.getElementById('score-ring');

  // Animated score counter
  const numEl = document.getElementById('score-num');
  clearInterval(resultScoreIntervalId);
  clearTimeout(resultRingTimeoutId);
  numEl.textContent = '0';
  scoreRing.style.background =
    'conic-gradient(var(--gold) 0deg, rgba(245,197,24,0.08) 0deg)';

  if (score > 0) {
    let count = 0;
    resultScoreIntervalId = setInterval(() => {
      count += 1;
      numEl.textContent = String(count);

      if (count >= score) {
        clearInterval(resultScoreIntervalId);
        resultScoreIntervalId = 0;
      }
    }, 120);
  }

  // Score ring (animates after a brief delay)
  resultRingTimeoutId = setTimeout(() => {
    const deg = (score / TOTAL_QUESTIONS) * 360;
    scoreRing.style.background =
      `conic-gradient(var(--gold) ${deg}deg, rgba(245,197,24,0.08) ${deg}deg)`;
  }, 300);

  // Icon
  const icons = {10:'🏆',9:'👑',8:'⚔️',7:'🔱',6:'🌊',5:'💎',4:'🧭',3:'📜',2:'🪝',1:'🎭',0:'💀'};
  document.getElementById('result-icon').textContent = icons[score] ?? '⚓';

  // Message
  const msgs = {
    10: { main: 'The Pirate King himself would be proud!',        sub: 'A perfect score! You are truly legendary — worthy of the Laugh Tale itself.' },
    9:  { main: 'Yonko-level mastery!',                            sub: 'Almost flawless — the Grand Line bows before your knowledge.' },
    8:  { main: 'Elite Crew material!',                            sub: 'Outstanding. The strongest seas hold no secrets from you.' },
    7:  { main: 'A worthy crew member!',                           sub: 'Impressive — you\'ve navigated treacherous waters with great skill.' },
    6:  { main: 'Nakama approved!',                                sub: 'The Straw Hats would welcome you aboard without question!' },
    5:  { main: 'Not bad, rookie!',                                sub: 'You\'re finding your sea legs. Keep studying and you\'ll become a legend.' },
    4:  { main: 'East Blue training needed.',                      sub: 'A decent start — but the New World demands far more from you.' },
    3:  { main: 'Somewhere between lost and found.',               sub: 'Your Log Pose is confused. Time to study the character a bit more!' },
    2:  { main: 'The sea does not forgive ignorance.',             sub: 'Every great pirate has been lost before. Don\'t give up!' },
    1:  { main: 'A long voyage lies ahead of you…',               sub: 'One correct answer. Even the greatest legends started from zero.' },
    0:  { main: 'Davy Jones has claimed your score!',              sub: 'No correct answers — but every great pirate sails through storms first.' },
  };
  const msg = msgs[score] ?? msgs[0];
  document.getElementById('result-msg-main').textContent = msg.main;
  document.getElementById('result-msg-sub').textContent  = msg.sub;

  // Coupon
  const couponSection = document.getElementById('coupon-section');
  const noCoupon      = document.getElementById('no-coupon-section');
  if (coupon) {
    couponSection.style.display = 'block';
    noCoupon.style.display = 'none';
    document.getElementById('coupon-code').textContent     = coupon.code;
    document.getElementById('coupon-discount').textContent  = coupon.discount;
    document.getElementById('coupon-label').textContent     = coupon.label;
  } else {
    couponSection.style.display = 'none';
    noCoupon.style.display = 'block';
  }

  renderReview();
}

function renderReview() {
  const list = document.getElementById('review-list');
  list.textContent = '';
  state.questions.forEach((q, qi) => {
    const userAns = state.userAnswers[qi];
    const correct = userAns === q.answer;
    const div = document.createElement('div');
    const questionLine = document.createElement('div');
    const answerLine = document.createElement('div');
    div.className = `review-item ${correct ? 'correct' : 'wrong'}`;
    div.style.animationDelay = `${qi * 0.05}s`;
    const corrOpt = q.options.find((option) => option.startsWith(`${q.answer}.`)) || q.answer;
    const userOpt = userAns
      ? (q.options.find((option) => option.startsWith(`${userAns}.`)) || userAns)
      : null;

    questionLine.className = 'review-q';
    questionLine.textContent = `${qi + 1}. ${q.question}`;

    answerLine.className = 'review-ans';
    answerLine.textContent = userOpt
      ? `${correct ? '✅' : '❌'} You: ${userOpt}`
      : '❓ Not answered';

    div.append(questionLine, answerLine);

    if (!correct) {
      const correctLine = document.createElement('div');
      correctLine.className = 'review-correct';
      correctLine.textContent = `✅ Correct: ${corrOpt}`;
      div.appendChild(correctLine);
    }

    list.appendChild(div);
  });
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'absolute';
  helper.style.left = '-9999px';
  document.body.appendChild(helper);
  helper.select();
  document.execCommand('copy');
  helper.remove();
}

// Copy coupon
document.getElementById('copy-coupon-btn').addEventListener('click', async () => {
  const code = document.getElementById('coupon-code').textContent;
  if (!code) return;

  try {
    await copyTextToClipboard(code);
    showToast(`"${code}" copied to clipboard!`);
  } catch (error) {
    console.error(error);
    showToast('Clipboard access failed. Copy the code manually.');
  }
});

// Review toggle
document.getElementById('toggle-review-btn').addEventListener('click', () => {
  const section = document.getElementById('review-section');
  const btn = document.getElementById('toggle-review-btn');
  const isOpen = section.classList.toggle('open');
  btn.textContent = isOpen ? 'Hide Answers ▲' : 'Review Answers ▼';
  btn.setAttribute('aria-expanded', String(isOpen));
});

// Play Again (same character)
document.getElementById('play-again-btn').addEventListener('click', () => {
  charInput.value = state.characterName;
  homeError.style.display = 'none';
  resetSubmitWarning();
  showView('home');
  setTimeout(() => charInput.focus(), 300);
});

// New Character
document.getElementById('new-char-btn').addEventListener('click', () => {
  charInput.value = '';
  homeError.style.display = 'none';
  resetQuizState();
  showView('home');
  setTimeout(() => charInput.focus(), 300);
});

// ─── Confetti ─────────────────────────────────────────────
function launchConfetti() {
  const colors = ['#f5c518','#ffd966','#c0392b','#3498db','#2ecc71','#e67e22','#9b59b6'];
  for (let i = 0; i < 80; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.cssText = `
        left: ${Math.random() * 100}vw;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        width: ${6 + Math.random() * 10}px;
        height: ${8 + Math.random() * 12}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        animation-duration: ${2 + Math.random() * 3}s;
        animation-delay: ${Math.random() * 0.5}s;
      `;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 5000);
    }, Math.random() * 600);
  }
}

// ─── Toast ────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  clearTimeout(toastTimeoutId);
  t.textContent = msg;
  t.classList.add('show');
  toastTimeoutId = setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  populateCharacterSelect();
  initBg();
  resetQuizState();
  showView('home');
  charInput.focus();
});
