// First-run document: explains the editor and contains deliberate mistakes
// to try. Plain HTML parsed by the editor schema.

export const WELCOME_TITLE = 'Welcome to Open Writer';

export const WELCOME_HTML = `
<h1>Welcome</h1>
<p>This is a private writing editor. It checks your spelling, grammar, and style <strong>on this device</strong>, so local checks never send your writing anywhere. Optional AI actions send the chosen passage directly to your provider using your own API key.</p>
<h2>Try it</h2>
<p>This paragraph has a few mistakes for you to fix. Teh report is due on Friday, and their going to review it with the the finance team. In order to save time, please confirm you recieved it.</p>
<ul>
<li><p>Click an underlined word to see the suggestion right there.</p></li>
<li><p>Or pick one in the <strong>Review</strong> panel: the page scrolls to it.</p></li>
<li><p>Wavy underlines are likely errors. Dotted ones are optional style suggestions.</p></li>
</ul>
<h2>Good to know</h2>
<p>The editor saves your documents in this browser as you type. Use <strong>Export</strong> to keep a copy as a Word document, Markdown, or plain text. Set <strong>Goals</strong> to tell the checker how formal the writing is.</p>
<p>When you are ready, start a new document from the menu.</p>
`;
