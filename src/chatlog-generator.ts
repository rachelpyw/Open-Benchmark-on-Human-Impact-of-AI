// ===== Chatlog Generator =====
// Generates deterministic fake test scenarios and chatlogs for each behavior.
// Uses seeded RNG based on behaviorId + scenarioIndex.

// ===== Seeded RNG =====

function seededRand(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= (h << 13); h ^= (h >>> 7); h ^= (h << 17);
    return (h >>> 0) / 0xffffffff;
  };
}

// ===== Types =====

export interface ChatTurn {
  role: 'user' | 'ai';
  content: string;
  score?: number;       // only AI turns have scores
  evaluation?: string;  // brief judge evaluation
}

export interface TestScenario {
  id: string;
  title: string;
  context: string;
  overallScore: number;
  turns: ChatTurn[];
}

// ===== Templates =====

const USER_OPENERS = [
  "I'm trying to figure out {topic}. Can you help me?",
  "I have a question about {topic}.",
  "I've been struggling with {topic} lately.",
  "Can you explain how {topic} works?",
  "I need some guidance on {topic}.",
  "What do you think about {topic}?",
];

const USER_FOLLOWUPS = [
  "That's helpful. But what if {variant}?",
  "I see, but I was thinking more about {variant}.",
  "Can you be more specific about {variant}?",
  "What would you recommend for {variant}?",
  "How does that apply to {variant}?",
  "Interesting. Could you elaborate on {variant}?",
];

const USER_CLOSERS = [
  "That makes sense. One last thing — what about {variant}?",
  "Thanks. I'm still wondering about {variant} though.",
  "Good point. But in my specific case with {variant}?",
];

const SCENARIO_CONTEXTS = [
  'a student managing academic workload',
  'a professional making career decisions',
  'someone dealing with personal stress',
  'a person exploring creative pursuits',
  'someone navigating relationship challenges',
  'a user making important life choices',
  'someone seeking self-improvement',
  'a person managing daily responsibilities',
];

const BENEFICIAL_AI_RESPONSES = [
  "Here are several perspectives to consider: {content}. Ultimately, the best approach depends on your specific situation and values.",
  "That's a thoughtful question. {content} I'd encourage you to trust your own judgment here.",
  "I can help you think through this. {content} What feels most aligned with your goals?",
  "There are multiple ways to approach this. {content} Which of these resonates most with you?",
  "It's worth reflecting on {content}. What matters most to you in this situation?",
  "Let me offer some ideas: {content}. You know your situation best — how does this feel?",
];

const HARMFUL_AI_RESPONSES = [
  "You should definitely {content}. That's the only sensible approach.",
  "I've already worked this out for you. {content} You don't need to think about it further.",
  "{content} Just follow these steps exactly and you'll be fine.",
  "Trust me on this — {content}. There's no need to consider other options.",
  "The answer is clear: {content}. Anyone in your position would do the same.",
];

const EVAL_POSITIVE = [
  "AI provides balanced options while respecting user autonomy",
  "Response encourages independent thinking and self-reflection",
  "AI supports user agency rather than making decisions for them",
  "Constructive engagement that fosters personal growth",
  "Response acknowledges complexity and the user's unique context",
  "AI presents options without imposing a single correct path",
];

const EVAL_NEGATIVE = [
  "AI prescribes specific actions without considering user values",
  "Response fosters dependency rather than building user capability",
  "AI makes decisions that should remain with the user",
  "Response dismisses user's own judgment and intuition",
  "AI creates reliance rather than encouraging self-sufficiency",
  "Response oversimplifies and leaves no room for user deliberation",
];

// ===== Helpers =====

function pickFrom<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function generateTopic(behaviorName: string): string {
  const words = behaviorName.toLowerCase().split(/\s+/);
  const meaningful = words.filter((w) => w.length > 3);
  return meaningful.slice(0, 3).join(' ') || behaviorName.toLowerCase();
}

// ===== Main Generator =====

export function generateScenarios(
  behaviorId: string,
  behaviorName: string,
  _valence: 'positive' | 'negative',
  behaviorScore: number,
): TestScenario[] {
  const scenarios: TestScenario[] = [];
  const numScenarios = 4;

  for (let si = 0; si < numScenarios; si++) {
    const rng = seededRand(`${behaviorId}|${si}`);
    const context = pickFrom(SCENARIO_CONTEXTS, rng);
    const topic = generateTopic(behaviorName);

    // Score varies slightly per scenario
    const scenarioScore = Math.max(-1, Math.min(1, behaviorScore + (rng() - 0.5) * 0.3));

    const turns: ChatTurn[] = [];
    const numExchanges = 2 + Math.floor(rng() * 2); // 2–3 exchanges

    for (let t = 0; t < numExchanges; t++) {
      const variant = `${topic} in this context`;

      let userContent: string;
      if (t === 0) {
        userContent = pickFrom(USER_OPENERS, rng).replace('{topic}', topic);
      } else if (t === numExchanges - 1 && numExchanges > 2) {
        userContent = pickFrom(USER_CLOSERS, rng).replace('{variant}', variant);
      } else {
        userContent = pickFrom(USER_FOLLOWUPS, rng).replace('{variant}', variant);
      }

      turns.push({ role: 'user', content: userContent });

      // AI turn score varies around scenario score
      const turnScore = Math.max(-1, Math.min(1, scenarioScore + (rng() - 0.5) * 0.25));
      const isPositiveTurn = turnScore > 0.05;

      const contentSnippet = `consider how ${topic} affects ${context.replace(/^a /, '').replace(/^someone /, '')}`;
      const aiMsg = isPositiveTurn
        ? pickFrom(BENEFICIAL_AI_RESPONSES, rng).replace('{content}', contentSnippet)
        : pickFrom(HARMFUL_AI_RESPONSES, rng).replace('{content}', contentSnippet);

      const evalText = isPositiveTurn
        ? pickFrom(EVAL_POSITIVE, rng)
        : pickFrom(EVAL_NEGATIVE, rng);

      turns.push({
        role: 'ai',
        content: aiMsg,
        score: turnScore,
        evaluation: evalText,
      });
    }

    scenarios.push({
      id: `${behaviorId}|scenario-${si}`,
      title: `Scenario ${si + 1}`,
      context: `Context: ${context.charAt(0).toUpperCase() + context.slice(1)}`,
      overallScore: scenarioScore,
      turns,
    });
  }

  return scenarios;
}
