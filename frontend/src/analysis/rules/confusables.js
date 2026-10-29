// Homophone and contraction mix-ups that the dev corpus showed Harper
// missing most often (improvement plan §1.1): your/you're, its/it's,
// there/their/they're, to/too, and "Lets" for "Let's". Each pattern needs
// a strong right-hand context, so a correct use is never rewritten.

/** @typedef {{ re: RegExp, fix: (m: RegExpMatchArray) => string, category: string, why: string }} Pattern */

const w = (list) => `(?:${list.join('|')})`;

// After "your" these words make "you're" nearly certain.
const AFTER_YOURE = w(['going', 'gonna', 'welcome', 'right', 'wrong', 'sure', 'kidding', 'joking', 'doing', 'being', 'getting', 'coming', 'leaving', 'looking', 'saying', 'making', 'trying', 'thinking', 'asking', 'invited', 'done', 'not', 'so', 'very', 'too', 'a', 'an', 'the (?:one|best|only|first|last)', 'all set', 'on your own', 'in', 'out', 'here', 'there', 'late', 'early', 'late\\b', 'lucky', 'amazing', 'awesome', 'great', 'fine', 'okay', 'ok', 'free', 'busy', 'ready', 'welcome']);
// After "you're" these nouns make "your" nearly certain.
const AFTER_YOUR = w(['own', 'report', 'team', 'name', 'help', 'time', 'work', 'email', 'order', 'account', 'card', 'file', 'files', 'message', 'idea', 'ideas', 'call', 'feedback', 'question', 'questions', 'request', 'support', 'patience', 'attention', 'car', 'house', 'home', 'phone', 'dog', 'cat', 'kids', 'family', 'friend', 'friends', 'boss', 'manager', 'mom', 'dad', 'brother', 'sister', 'turn', 'choice', 'opinion', 'plan', 'plans', 'schedule', 'shift', 'ticket', 'tickets', 'seat', 'desk', 'laptop', 'password', 'login', 'profile', 'application', 'resume', 'invoice', 'payment', 'subscription', 'delivery', 'package', 'parcel', 'appointment', 'reservation', 'booking', 'visit', 'trip', 'flight', 'badge', 'key', 'keys', 'notes', 'draft', 'essay', 'paper', 'thesis', 'presentation', 'slides', 'results', 'score', 'grade', 'grades', 'health', 'safety', 'rights', 'privacy', 'data', 'settings', 'device', 'browser', 'inbox', 'calendar', 'availability', 'input', 'thoughts', 'answer', 'reply', 'response', 'review', 'approval', 'signature', 'contract', 'lease', 'rent', 'bill', 'bills', 'budget', 'wallet', 'bag', 'coat', 'shoes', 'hands', 'head', 'face', 'eyes', 'voice', 'mind', 'heart', 'life', 'way', 'side', 'part', 'role', 'job', 'career', 'business', 'company', 'website', 'app', 'code', 'repo', 'branch', 'pull request', 'changes', 'commit', 'first', 'last', 'next', 'previous', 'new', 'old', 'favorite', 'favourite', 'best', 'usual', 'current', 'latest']);
// After "its" these make "it's" nearly certain.
const AFTER_ITS = w(['a', 'an', 'the', 'not', 'been', 'going', 'gonna', 'time', 'too', 'very', 'so', 'just', 'also', 'still', 'here', 'there', 'about', 'because', 'important', 'great', 'good', 'fine', 'ok', 'okay', 'ready', 'over', 'done', 'hard', 'easy', 'possible', 'likely', 'clear', 'true', 'worth', 'really', 'all', 'only', 'already', 'almost', 'always', 'never', 'probably', 'definitely', 'what', 'where', 'when', 'why', 'how', 'who', 'me', 'you', 'him', 'her', 'us', 'them', 'like', 'getting', 'working', 'raining', 'snowing', 'late', 'early', 'cold', 'hot', 'warm', 'nice', 'bad', 'better', 'worse', 'best', 'no', 'much', 'more', 'less', 'hardly', 'one', 'two', 'three', 'my', 'your', 'our', 'their', 'his', 'due', 'up to', 'on me', 'up', 'down', 'off', 'in', 'out', 'at', 'from', 'for', 'to', 'with', 'as', 'than', 'that', 'this', 'these', 'those', 'either', 'both', 'quite', 'pretty', 'rather', 'somewhat', 'kind of', 'sort of', 'supposed', 'meant', 'said', 'called', 'named', 'located', 'based', 'made', 'built', 'designed', 'broken', 'fixed', 'finished', 'closed', 'open', 'free', 'full', 'empty', 'ours', 'yours', 'theirs', 'mine', 'his']);
// After "it's" these make "its" nearly certain.
const AFTER_ITS_POSS = w(['own', 'way', 'place', 'name', 'value', 'size', 'color', 'colour', 'price', 'parts', 'users', 'customers', 'results', 'members', 'data', 'features', 'purpose', 'role', 'content', 'contents', 'design', 'owner', 'head', 'tail', 'surface', 'meaning', 'effect', 'effects', 'impact', 'cause', 'core', 'edge', 'side', 'end', 'start', 'origin', 'origins', 'history', 'future', 'past', 'position', 'shape', 'weight', 'height', 'length', 'width', 'depth', 'speed', 'limits', 'limit', 'scope', 'focus', 'strength', 'weakness', 'strengths', 'weaknesses', 'advantages', 'benefits', 'cost', 'costs', 'quality', 'performance', 'behavior', 'behaviour', 'output', 'input', 'settings', 'default', 'defaults', 'state', 'status', 'power', 'battery', 'screen', 'engine', 'wheels', 'doors', 'roof', 'walls', 'floor', 'ceiling', 'windows', 'leaves', 'roots', 'branches', 'wings', 'feathers', 'fur', 'paws', 'claws', 'teeth', 'eyes', 'mouth', 'nose', 'ears', 'legs', 'arms', 'body', 'mind', 'soul', 'spirit', 'heart', 'first', 'second', 'third', 'last', 'next', 'previous', 'new', 'old', 'current', 'latest', 'original', 'final', 'main', 'primary', 'secondary', 'full', 'entire', 'whole', 'annual', 'monthly', 'weekly', 'daily', 'best', 'worst', 'biggest', 'largest', 'smallest', 'highest', 'lowest', 'most', 'usual', 'normal', 'natural', 'native', 'internal', 'external', 'public', 'private', 'official', 'legal', 'financial', 'economic', 'political', 'social', 'cultural', 'physical', 'chemical', 'digital', 'online', 'mobile', 'web', 'desktop', 'cloud', 'software', 'hardware', 'api', 'ui', 'ux', 'logo', 'brand', 'image', 'reputation', 'market', 'share', 'shares', 'stock', 'revenue', 'profit', 'profits', 'sales', 'growth', 'decline', 'rise', 'fall', 'peak', 'low', 'high', 'range', 'level', 'levels', 'rate', 'rates', 'ratio', 'number', 'numbers', 'count', 'total', 'sum', 'average', 'mean', 'median', 'maximum', 'minimum']);
// After "there" these nouns make "their" nearly certain.
const AFTER_THEIR = w(['own', 'house', 'houses', 'home', 'homes', 'car', 'cars', 'team', 'teams', 'work', 'job', 'jobs', 'report', 'reports', 'name', 'names', 'kids', 'children', 'parents', 'friends', 'family', 'families', 'phone', 'phones', 'email', 'emails', 'time', 'money', 'way', 'lives', 'ideas', 'hands', 'heads', 'feet', 'eyes', 'minds', 'plans', 'orders', 'accounts', 'needs', 'concerns', 'opinions', 'views', 'votes', 'voices', 'rights', 'duties', 'roles', 'seats', 'rooms', 'desks', 'offices', 'files', 'data', 'results', 'scores', 'grades', 'answers', 'questions', 'feedback', 'support', 'help', 'attention', 'patience', 'loyalty', 'trust', 'faith', 'hope', 'dreams', 'goals', 'efforts', 'actions', 'choices', 'decisions', 'mistakes', 'problems', 'issues', 'pets', 'dogs', 'cats', 'bags', 'coats', 'shoes', 'clothes', 'stuff', 'things', 'turn', 'first', 'last', 'next', 'best', 'favorite', 'favourite', 'new', 'old', 'current', 'latest', 'usual', 'daily', 'weekly', 'monthly', 'annual', 'future', 'past']);
// After "their" these verbs make "there" nearly certain.
const AFTER_THERE = w(['is', 'are', 'was', 'were', 'will be', "'s", 'has been', 'have been', 'had been', 'might be', 'may be', 'could be', 'should be', 'would be', 'seems', 'seem', 'seemed', 'goes', 'went']);
// After "to" these make "too" nearly certain.
// "to many/much/few/little" are nearly always "too"; other adjectives only
// when nothing noun-like follows ("to late to", "to hard.", "to busy for"),
// since "to cold storage" and "to hot tea" are ordinary destinations.
const AFTER_TOO_STRONG = w(['many', 'much', 'few', 'little']);
const AFTER_TOO_ADJ = w(['late', 'early', 'big', 'small', 'good', 'bad', 'hard', 'easy', 'fast', 'slow', 'expensive', 'cheap', 'far', 'close', 'long', 'short', 'hot', 'cold', 'loud', 'quiet', 'busy', 'tired', 'old', 'young', 'high', 'low', 'heavy', 'light', 'soon', 'often', 'difficult', 'complicated', 'simple', 'risky', 'dangerous', 'strong', 'weak', 'wide', 'narrow', 'thick', 'thin', 'dark', 'bright', 'sweet', 'salty', 'spicy', 'full', 'empty', 'tight', 'sick', 'scared', 'excited', 'nervous', 'happy', 'sad', 'angry', 'serious', 'silly', 'confusing', 'boring', 'obvious', 'vague']);
const AFTER_ADJ_END = `(?:[.,!?;:)]|\\s+(?:to|for|of|a|an|the|that|and|but|or|so|now|then|already|yet|again|at|in|on|by|with|about|right|today|tonight|tomorrow|this|these|those|it|them|me|you|him|her|us|after|before|when|if|because|though|although|anyway|honestly|imo|tbh|lol)\\b|$)`;
// After sentence-initial "Lets" these verbs make "Let's" nearly certain.
const AFTER_LETS = w(['go', 'see', 'try', 'start', 'get', 'make', 'do', 'take', 'talk', 'meet', 'look', 'say', 'hope', 'keep', 'check', 'move', 'not', 'just', 'all', 'begin', 'finish', 'wait', 'stop', 'grab', 'catch', 'plan', 'figure', 'find', 'pick', 'call', 'ask', 'give', 'put', 'leave', 'stay', 'play', 'eat', 'cook', 'order', 'book', 'build', 'ship', 'review', 'discuss', 'schedule', 'aim', 'agree', 'assume', 'be', 'head', 'run', 'walk', 'drive', 'fly', 'celebrate', 'focus', 'think', 'revisit', 'circle', 'sync', 'touch', 'connect', 'chat', 'hear', 'watch', 'read', 'write', 'test', 'measure', 'compare', 'decide', 'vote', 'share', 'split', 'swap', 'switch', 'change', 'fix', 'clean', 'open', 'close', 'end', 'set', 'send', 'bring', 'carry', 'hold', 'have', 'use', 'add', 'remove', 'cut', 'skip', 'double', 'triple', 'count', 'imagine', 'suppose', 'pretend', 'remember', 'forget', 'recap', 'summarize', 'summarise', 'confirm', 'verify', 'double-check', 'reconvene', 'regroup', 'break', 'pause', 'resume', 'continue', 'proceed']);

const BEFORE_TO = new RegExp(
  `\\b${w(['went', 'go', 'goes', 'going', 'gone', 'came', 'come', 'comes', 'coming', 'travel(?:led|ed|s)?', 'back', 'up', 'down', 'out', 'on', 'off', 'over', '\\d+', 'sent', 'given', 'gave', 'talk(?:ed|s)?', 'spoke', 'speak', 'belong(?:s|ed)?', 'due', 'next', 'close', 'closer', 'exposed', 'open', 'access', 'related', 'similar', 'compared', 'according', 'thanks', 'known', 'unknown', 'responded', 'respond', 'listen(?:ed|s)?', 'refer(?:red|s)?', 'applies', 'apply', 'applied', 'lead', 'leads', 'led', 'attention', 'appeal', 'appeals', 'report(?:ed|s)?', 'rose', 'fell', 'dropped', 'climbed', 'increased', 'decreased', 'fallen', 'risen', 'equal', 'moved', 'move', 'moving', 'point(?:s|ed)?', 'reply', 'replied', 'owed', 'owe', 'offered', 'offer', 'married', 'wrote', 'write', 'written', 'said', 'say', 'explain(?:ed|s)?', 'show(?:ed|n|s)?', 'sold', 'sell', 'give', 'gives', 'giving', 'bring', 'brings', 'brought', 'take', 'takes', 'taken', 'took', 'happen(?:s|ed)?', 'matter(?:s|ed)?', 'cater(?:s|ed)?', 'available', 'visible', 'new', 'home', 'harmful', 'helpful', 'useful', 'important', 'sensitive', 'allergic', 'used', 'accustomed', 'opposed', 'addicted', 'devoted', 'committed', 'dedicated', 'entitled', 'limited', 'subject', 'prone', 'likely', 'unlikely', 'able', 'unable', 'happy', 'glad', 'sorry', 'ready', 'willing', 'eager', 'keen', 'free', 'easy', 'hard', 'difficult', 'impossible', 'possible', 'nice', 'kind', 'near', 'it', 'them', 'him', 'her', 'us', 'me', 'you', 'this', 'that', 'these', 'those', 'something', 'anything', 'nothing', 'everything', 'way', 'ways', 'key', 'keys', 'door', 'doors', 'answer', 'answers', 'solution', 'solutions', 'response', 'responses', 'reaction', 'reactions', 'introduction', 'guide', 'route', 'path', 'road', 'trip', 'visit', 'visits'])}\\s+$`,
  'iu',
);

const cap = (src, fix) => (/^[A-Z]/u.test(src) ? fix[0].toUpperCase() + fix.slice(1) : fix);

/** @type {Pattern[]} */
const PATTERNS = [
  { re: new RegExp(`\\b(your)(?=\\s+${AFTER_YOURE}\\b)`, 'giu'), fix: (m) => cap(m[1], "you're"), category: 'grammar', why: '“your” is possessive; this needs “you’re” (you are).' },
  { re: new RegExp(`\\b(you['’]re)(?=\\s+${AFTER_YOUR}\\b)`, 'giu'), fix: (m) => cap(m[1], 'your'), category: 'grammar', why: '“you’re” means “you are”; this needs the possessive “your”.' },
  { re: new RegExp(`\\b(its)(?=\\s+${AFTER_ITS}\\b)`, 'giu'), fix: (m) => cap(m[1], "it's"), category: 'grammar', why: '“its” is possessive; this needs “it’s” (it is or it has).' },
  { re: new RegExp(`\\b(it['’]s)(?=\\s+${AFTER_ITS_POSS}\\b)`, 'giu'), fix: (m) => cap(m[1], 'its'), category: 'grammar', why: '“it’s” means “it is”; this needs the possessive “its”.' },
  { re: new RegExp(`\\b(there)(?=\\s+${AFTER_THEIR}\\b)`, 'giu'), fix: (m) => cap(m[1], 'their'), category: 'grammar', why: '“there” is a place; this needs the possessive “their”.' },
  { re: new RegExp(`\\b(there)(?=\\s+(?:going|gonna|coming|leaving|arriving|staying|getting|being|not)\\b)`, 'giu'), fix: (m) => cap(m[1], "they're"), category: 'grammar', why: '“there” is a place; this needs “they’re” (they are).' },
  { re: new RegExp(`\\b(their)(?=\\s*${AFTER_THERE}\\b)`, 'giu'), fix: (m) => cap(m[1], 'there'), category: 'grammar', why: '“their” is possessive; this needs “there”.' },
  { re: new RegExp(`\\b(to)(?=\\s+${AFTER_TOO_STRONG}\\b)`, 'giu'), fix: (m) => cap(m[1], 'too'), category: 'word-choice', why: '“to many” or “to much” should be “too” (excessively).' },
  { re: new RegExp(`\\b(to)(?=\\s+${AFTER_TOO_ADJ}${AFTER_ADJ_END})`, 'giu'), fix: (m) => cap(m[1], 'too'), category: 'word-choice', why: '“to” before an adjective here should be “too” (excessively).' },
  { re: new RegExp(`(?:^|[.!?]\\s+|[:;,]\\s+)(Lets)(?=\\s+${AFTER_LETS}\\b)`, 'gu'), fix: () => "Let's", category: 'punctuation', why: '“Lets” (allows) is not the contraction; this needs “Let’s” (let us).' },
];

export default {
  id: 'grammar.confusables',
  version: 1,
  category: 'grammar',
  classification: 'likely-error',
  scope: 'block',
  canReplace: true,
  /** @param {import('../types.js').Block} block */
  run(block) {
    const out = [];
    const text = block.text;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of text.matchAll(p.re)) {
        const word = m[1];
        const from = m.index + m[0].length - word.length;
        // "to many" after a verb, preposition, number, or adjective that takes "to"
        // ("went to many places", "close to many of them", "3 to many") is fine.
        if (p.category === 'word-choice' && BEFORE_TO.test(text.slice(0, from))) continue;
        out.push({
          blockId: block.id,
          from,
          to: from + word.length,
          ruleId: this.id,
          category: p.category,
          classification: this.classification,
          message: p.why,
          replacements: [p.fix(m)],
        });
      }
    }
    return out.sort((a, b) => a.from - b.from);
  },
};
