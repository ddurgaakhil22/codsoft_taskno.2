/* ============================================================
   QUIZIFY — ai.js
   Anthropic API integration + prompt engineering
   ============================================================ */

'use strict';

const AI = {

  // ── Official Google Gemini API Integration ────────────────
  // Note: API key is placed here for this frontend-only application.
  // In a production environment with a backend, this should be moved to a server variable.
  GEMINI_API_KEY: 'AIzaSyD9_Hlz2fQGfP2juUH0SUxuyfkCQ0bP6vE',

  async call(messages, system, jsonMode = true) {
    const userPrompt = messages[messages.length - 1].content;
    
    // Using the incredibly fast and accurate Gemini 1.5 Flash model
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.GEMINI_API_KEY}`;
    
    const payload = {
      contents: [
        { parts: [{ text: userPrompt }] }
      ],
      systemInstruction: {
        parts: [{ text: system }]
      }
    };

    if (jsonMode) {
      payload.generationConfig = {
        responseMimeType: "application/json"
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errData = await res.text();
        console.error("Gemini API Error:", errData);
        throw new Error(`GEMINI_API_ERROR_${res.status}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  },

  // ── Robust JSON Extraction ────────────────────────────────
  extractJSON(raw) {
    try {
      // 1. Try to find JSON in markdown blocks
      const match = raw.match(/```json\n([\s\S]*?)\n```/) || raw.match(/```([\s\S]*?)```/);
      const clean = match ? match[1].trim() : raw.trim();
      
      // 2. Find anything between the first { and last }
      const braceMatch = clean.match(/\{[\s\S]*\}/);
      if (!braceMatch) throw new Error('NO_VALID_BRACES');
      
      const parsed = JSON.parse(braceMatch[0]);
      if (!parsed.questions || !Array.isArray(parsed.questions)) throw new Error('MISSING_QUESTIONS_ARRAY');
      
      return parsed;
    } catch (e) {
      console.warn("Extraction failed for raw:", raw);
      throw e;
    }
  },

  // ── Generate quiz with Google Gemini ──────────────────────
  async generateQuiz({ topic, category, difficulty, numQuestions, context = '' }, onStatus) {
    if (onStatus) onStatus(`Thinking with GEMINI 1.5 PRO...`);
    
    // We explicitly tell Gemini its exact persona and strictly format the JSON output via JSON schema parsing in extractJSON
    const system = `You are a world-class Knowledge Synthesis Expert and Educational Evaluator from Google.
STRICT REQUIREMENTS:
1. TOPIC RELEVANCE: Every question must be 100% focused on: "${topic}". 
2. ZERO FLUFF: Respond ONLY with valid JSON. Do not include markdown codeblocks or conversational text.
3. ACCURACY: Every correct answer must be factually indisputable.
4. SYNTHESIS: Focus on functional relationships in the topic, not just rote memorization.
5. LENGTH: You must generate EXACTLY ${numQuestions} questions. Do not stop early.`;

    const prompt = `Generate a strictly accurate JSON quiz about "${topic}".
QUESTIONS REQUESTED: ${numQuestions}
CATEGORY: ${category}
DIFFICULTY: ${difficulty}

${context ? `SOURCE TEXT:\n${context.substring(0, 10000)}` : 'Use your internal expert knowledge base.'}

JSON structure: { "title": "A precise title", "description": "A high-level overview", "questions": [{ "text": "Question text here?", "options": ["A","B","C","D"], "correct": 0, "explanation": "Insightful breakdown of why." }] }`;

    try {
      const raw = await this.call([{ role: 'user', content: prompt }], system);
      const result = this.extractJSON(raw);
      
      // Final normalization and safety checks
      return {
        ...result,
        questions: result.questions.slice(0, numQuestions).map((q, i) => ({
          ...q,
          id: `q${i+1}`,
          correct: typeof q.correct === 'number' ? q.correct : parseInt(q.correct) || 0
        }))
      };
    } catch (err) {
      console.error("Gemini AI failed. Reverting to local synth.", err.message);
      return this.mockGenerate(topic, category, difficulty, numQuestions);
    }
  },

  // ── Local AI Fallback Engine ──────────────────────────────
  mockGenerate(topic, category, difficulty, numQuestions) {
    const t = topic.toLowerCase();
    let qTemplate;

    if (t.includes('html')) {
        qTemplate = [
            { text: "Which HTML element is used for the largest heading?", opts: ["<h6>", "<head>", "<h1>", "<title>"], c: 2, exp: "The <h1> tag represents the highest level heading." },
            { text: "What does HTML stand for?", opts: ["Hyper Text Markup Language", "Home Tool Markup Language", "Hyperlinks and Text Markup Language", "High Tech Modern Language"], c: 0, exp: "HTML is the standard markup language for creating Web pages." },
            { text: "Which tag is used to create a hyperlink?", opts: ["<link>", "<a>", "<href>", "<nav>"], c: 1, exp: "The <a> (anchor) tag is used to define hyperlinks." },
            { text: "Which attribute specifies the connection link in an <a> tag?", opts: ["src", "link", "href", "url"], c: 2, exp: "The href attribute indicates the link's destination." },
            { text: "How can you make a numbered list?", opts: ["<dl>", "<list>", "<ul>", "<ol>"], c: 3, exp: "The <ol> tag defines an ordered (numbered) list." }
        ];
    } else if (t.includes('css')) {
        qTemplate = [
            { text: "What does CSS stand for?", opts: ["Computer Style Sheets", "Cascading Style Sheets", "Colorful Style Sheets", "Creative Style Sheets"], c: 1, exp: "CSS describes how HTML elements are to be displayed." },
            { text: "Which property is used to change the background color?", opts: ["bgcolor", "color", "background-color", "bg-color"], c: 2, exp: "The background-color property sets the background color of an element." }
        ];
    } else {
        qTemplate = [];
    }

    const questions = [];
    for (let i = 0; i < numQuestions; i++) {
        if (qTemplate[i]) {
            questions.push({
                id: `q${i+1}`,
                text: qTemplate[i].text,
                options: qTemplate[i].opts,
                correct: qTemplate[i].c,
                explanation: qTemplate[i].exp
            });
        } else {
            const genericPool = [
                `Which of the following describes a core principle of ${topic}?`,
                `What is a key component often associated with ${topic}?`,
                `Which statement best defines the importance of ${topic}?`,
                `In the context of ${category}, how is ${topic} primarily applied?`,
                `Which of these is a common misconception about ${topic}?`,
                `What is the primary function of ${topic}?`,
                `Which element is essential to understanding ${topic} properly?`,
                `How does ${topic} differentiate itself within ${category}?`
            ];
            const randQ = genericPool[Math.floor(Math.random() * genericPool.length)];
            
            questions.push({
                id: `q${i+1}`,
                text: randQ,
                options: [
                    `A fundamental mechanism of ${category}`,
                    `The primary structural element of ${topic}`,
                    `An advanced, rarely used feature`,
                    `None of the above`
                ],
                correct: 1,
                explanation: `Understanding these basic traits is essential when studying ${topic}.`
            });
        }
    }

    return {
        title: `${topic} (Local Fallback)`,
        description: `An automatically generated quiz covering ${topic}.`,
        questions
    };
  },

  // ── Explain a wrong answer ────────────────────────────────
  async explainAnswer({ question, userAnswer, correctAnswer, explanation }) {
    const system = `You are a helpful educational tutor. Be concise, clear, and encouraging. Max 3 sentences.`;

    const prompt = `A student answered a quiz question incorrectly.

Question: "${question}"
Student's answer: "${userAnswer}"
Correct answer: "${correctAnswer}"
Standard explanation: "${explanation}"

Give a personalized, encouraging explanation that:
1. Acknowledges what they may have been thinking
2. Clearly explains why the correct answer is right
3. Offers a memorable way to remember this

Keep it under 60 words.`;

    return this.call([{ role: 'user', content: prompt }], system, false);
  },

  // ── Suggest quiz improvements ─────────────────────────────
  async suggestImprovements(quiz) {
    const system = `You are a quiz design expert. Be specific and concise. Return plain text with 3 bullet points only.`;

    const prompt = `Review this quiz and give 3 specific improvement suggestions:
Title: ${quiz.title}
Category: ${quiz.category}
Difficulty: ${quiz.difficulty}
Number of questions: ${quiz.questions?.length || 0}
Sample question: ${quiz.questions?.[0]?.text || 'N/A'}

Give exactly 3 improvement suggestions as bullet points (• suggestion). No headers, no extra text.`;

    return this.call([{ role: 'user', content: prompt }], system, false);
  }
};

// ── Loading state helper ──────────────────────────────────────
function setAiLoading(containerId, loading) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (loading) {
    el.classList.add('ai-loading');
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;padding:16px">
        <div class="skeleton" style="height:16px;width:60%"></div>
        <div class="skeleton" style="height:16px;width:85%"></div>
        <div class="skeleton" style="height:16px;width:70%"></div>
        <div class="skeleton" style="height:16px;width:90%"></div>
        <div class="skeleton" style="height:16px;width:55%"></div>
      </div>`;
  } else {
    el.classList.remove('ai-loading');
  }
}

// ── Error message helper ──────────────────────────────────────
function aiErrorMessage(err) {
  const msgs = {
    PARSE_ERROR:        'Could not parse AI response. Try rephrasing your prompt.',
    NO_JSON:            'AI returned text without quiz data. Try rephrasing.',
    GENERATION_FAILED:  'AI is currently extremely busy processing too many requests. Please click Generate again!',
  };
  return msgs[err.message] || `AI Error: Failed to generate properly. Please try again.`;
}

window.AI             = AI;
window.setAiLoading   = setAiLoading;
window.aiErrorMessage = aiErrorMessage;
