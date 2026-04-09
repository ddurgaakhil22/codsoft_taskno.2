/* ============================================================
   QUIZORA — quiz.js
   Quiz player state machine + timer + gamification
   ============================================================ */

'use strict';

const QuizEngine = {
  // ── State ───────────────────────────────────────────────
  quiz: null,
  questions: [],
  currentIdx: 0,
  answers: [],   // user's chosen index per question
  score: 0,
  streak: 0,
  maxStreak: 0,
  startTime: 0,
  questionStart: 0,
  timings: [],   // time taken per question in seconds
  xp: 0,
  timer: null,
  timeLeft: 0,
  locked: false,  // answer locked for current question

  // ── Callbacks (set by player page) ─────────────────────
  onQuestion: null,   // (question, idx, total) => void
  onAnswer: null,   // (isCorrect, correctIdx, chosenIdx) => void
  onTick: null,   // (timeLeft, total) => void
  onTimeout: null,   // () => void
  onFinish: null,   // (result) => void

  // ── Load Quiz ───────────────────────────────────────────
  load(quizId) {
    const quiz = window.Quizzes.get(quizId);
    if (!quiz) return false;

    this.quiz = quiz;
    // Fisher-Yates or simple sort to shuffle questions randomly
    this.questions = [...quiz.questions].sort(() => Math.random() - 0.5);
    this.currentIdx = 0;
    this.answers = new Array(this.questions.length).fill(null);
    this.score = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.startTime = Date.now();
    this.timings = [];
    this.xp = 0;
    this.locked = false;
    return true;
  },

  // ── Start / advance ─────────────────────────────────────
  start() {
    this._showQuestion(0);
  },

  _showQuestion(idx) {
    if (idx >= this.questions.length) { this._finish(); return; }

    this.currentIdx = idx;
    this.locked = false;
    this.questionStart = Date.now();
    this.timeLeft = this.quiz.timePerQuestion || 30;

    if (this.onQuestion) {
      this.onQuestion(this.questions[idx], idx, this.questions.length);
    }

    this._startTimer();
  },

  // ── Timer ───────────────────────────────────────────────
  _startTimer() {
    this._clearTimer();
    const total = parseInt(this.quiz.timePerQuestion) || 30;
    this.timeLeft = total;

    console.log(`[QuizEngine] Starting timer for question ${this.currentIdx + 1}. Total time: ${total}s`);

    // Initial tick to show starting time
    if (this.onTick) {
      try {
        this.onTick(this.timeLeft, total);
      } catch (e) {
        console.error("[QuizEngine] Error in initial onTick:", e);
      }
    }

    this.timer = setInterval(() => {
      // Calculate more accurately using Date.now()
      const elapsed = Math.floor((Date.now() - this.questionStart) / 1000);
      this.timeLeft = Math.max(0, total - elapsed);

      if (this.onTick) {
        try {
          this.onTick(this.timeLeft, total);
        } catch (e) {
          console.error("[QuizEngine] Error in onTick:", e);
        }
      }

      if (this.timeLeft <= 0) {
        console.log("[QuizEngine] Time hit 0, triggering timeout.");
        this._clearTimer();
        this._handleTimeout();
      }
    }, 1000);
  },

  _clearTimer() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  },

  _handleTimeout() {
    if (this.locked) return;
    this.locked = true;
    const timeTaken = this.quiz.timePerQuestion || 30;
    this.timings.push(timeTaken);
    this.answers[this.currentIdx] = -1; // -1 = timed out
    this.streak = 0;
    if (this.onTimeout) this.onTimeout();
  },

  // ── Answer ──────────────────────────────────────────────
  answer(chosenIdx) {
    if (this.locked) return;
    this.locked = true;
    this._clearTimer();

    const q = this.questions[this.currentIdx];
    const isCorrect = chosenIdx === q.correct;
    const timeTaken = Math.round((Date.now() - this.questionStart) / 1000);

    this.timings.push(timeTaken);
    this.answers[this.currentIdx] = chosenIdx;

    if (isCorrect) {
      this.score++;
      this.streak++;
      this.maxStreak = Math.max(this.maxStreak, this.streak);
    } else {
      this.streak = 0;
    }

    if (this.onAnswer) this.onAnswer(isCorrect, q.correct, chosenIdx);
  },

  // ── Next question ────────────────────────────────────────
  next() {
    this._showQuestion(this.currentIdx + 1);
  },

  // ── Finish ──────────────────────────────────────────────
  _finish() {
    this._clearTimer();
    const totalTime = Math.round((Date.now() - this.startTime) / 1000);
    const total = this.questions.length;
    const avgTime = this.timings.length
      ? Math.round(this.timings.reduce((a, b) => a + b, 0) / this.timings.length)
      : 0;

    const xp = window.calcXP({
      correct: this.score,
      total,
      timeTaken: avgTime,
      timeLimitSec: this.quiz.timePerQuestion || 30,
      streak: this.maxStreak
    });
    this.xp = xp;

    // Persist attempt
    const attempt = window.Attempts.create({
      quizId: this.quiz.id,
      score: this.score,
      total,
      xp,
      answers: this.answers,
      timings: this.timings,
      totalTime,
      streak: this.maxStreak,
    });

    // Update play count
    window.Quizzes.update(this.quiz.id, { playCount: (this.quiz.playCount || 0) + 1 });

    // Add XP to user
    window.User.addXP(xp);

    // Track demo attempt for guest users
    window.trackDemoAttempt();

    // Save result to sessionStorage for results page
    const result = {
      quizId: this.quiz.id,
      quizTitle: this.quiz.title,
      score: this.score,
      total,
      xp,
      answers: this.answers,
      questions: this.questions,
      timings: this.timings,
      totalTime,
      streak: this.maxStreak,
      attemptId: attempt.id,
      pct: Math.round((this.score / total) * 100),
    };

    sessionStorage.setItem('qfy_result', JSON.stringify(result));

    if (this.onFinish) this.onFinish(result);
  },

  // ── Abort ────────────────────────────────────────────────
  abort() {
    this._clearTimer();
    this.quiz = null;
  }
};

window.QuizEngine = QuizEngine;
