const fs = require('fs');

let html = fs.readFileSync('tungston-prompt-maker/index.html', 'utf8');

// 1. Theme configuration & Toggle
html = html.replace(
  /:root\{--concrete:#b9b9b4;--paper:#dcdcd6;--ink:#0a0a0a;--amber:#ffb000;--gun:#26272a\}/,
  `:root{--concrete:#24272b;--paper:#2e3237;--ink:#f2efe6;--amber:#ffb800;--gun:#3a3f45;}
[data-theme="light"]{--concrete:#b9b9b4;--paper:#dcdcd6;--ink:#0a0a0a;--amber:#ffb000;--gun:#26272a;}`
);

// Add history item CSS
html = html.replace(
  /<\/style>/,
  `.history-item { border: 4px solid var(--ink); padding: 14px; margin-bottom: 14px; background: var(--gun); color: var(--ink); position: relative; }
.history-item pre { min-height: auto; padding: 10px; margin-top: 10px; border: 2px solid var(--ink); }
.delete-btn { position: absolute; top: 10px; right: 10px; background: var(--amber); color: var(--ink); border: 2px solid var(--ink); cursor: pointer; font-family: 'Archivo Black', sans-serif; font-size: 12px; padding: 4px 8px; text-transform: uppercase; }
.delete-btn:hover { background: var(--ink); color: var(--amber); }
@media(max-width:560px){
  .bar { flex-direction: column; align-items: center; }
  .back-group { width: 100%; justify-content: center; border-left: none; border-top: 4px solid var(--ink); }
  .back-group .back { flex: 1; text-align: center; justify-content: center; padding: 10px; border-left: none; }
  .back-group #theme-toggle { border-right: 4px solid var(--ink); }
}
</style>`
);

// Add toggle button to header
html = html.replace(
  /<a class="back" href="https:\/\/tungston-hazel\.vercel\.app\/">← ALL TOOLS<\/a>/,
  `<div class="back-group" style="display: flex; border-left: 4px solid var(--ink);">
    <button id="theme-toggle" class="back" style="border:none; cursor:pointer; font-family:inherit; font-size:inherit; border-left:none;">☀️ LIGHT</button>
    <a class="back" href="https://tungston-hazel.vercel.app/" style="border-left: 4px solid var(--ink);">← ALL TOOLS</a>
  </div>`
);

// Fix .back styles to not duplicate border
html = html.replace(
  /\.back\{display:flex;align-items:center;padding:0 20px;border-left:4px solid var\(--ink\);font-weight:700;text-decoration:none;background:var\(--ink\);color:var\(--amber\)\}/,
  `.back{display:flex;align-items:center;padding:0 20px;font-weight:700;text-decoration:none;background:var(--ink);color:var(--amber)}`
);

// Add history section HTML
html = html.replace(
  /<\/main>/,
  `  <section class="panel" id="history-panel">
    <div class="ph"><span>HISTORY</span><em>RECENT PROMPTS</em></div>
    <div class="pb" id="history-list">
    </div>
    <div class="pb" style="padding-top: 0;">
      <button class="go" id="clear-history" style="font-size: 14px; padding: 8px 16px; margin-top: 0;">Clear History</button>
    </div>
  </section>
</main>`
);

// Add history logic and theme toggle logic
const scriptAdditions = `
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    document.documentElement.removeAttribute('data-theme');
    themeToggle.textContent = '☀️ LIGHT';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    themeToggle.textContent = '🌙 DARK';
  }
});

function loadHistory() {
  const history = JSON.parse(localStorage.getItem('promptHistory') || '[]');
  const list = document.getElementById('history-list');
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = '<p style="font-weight:500;">No history yet.</p>';
    return;
  }
  history.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = \`
      <strong>Idea:</strong> \${item.idea.substring(0, 80)}\${item.idea.length > 80 ? '...' : ''}
      <pre>\${item.prompt.replace(/</g, "&lt;")}</pre>
      <button class="delete-btn" data-index="\${index}">X</button>
    \`;
    list.appendChild(div);
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      deleteHistory(e.target.getAttribute('data-index'));
    });
  });
}

function saveToHistory(idea, prompt) {
  const history = JSON.parse(localStorage.getItem('promptHistory') || '[]');
  history.unshift({ idea, prompt, date: new Date().toISOString() });
  localStorage.setItem('promptHistory', JSON.stringify(history));
  loadHistory();
}

function deleteHistory(index) {
  const history = JSON.parse(localStorage.getItem('promptHistory') || '[]');
  history.splice(index, 1);
  localStorage.setItem('promptHistory', JSON.stringify(history));
  loadHistory();
}

document.getElementById('clear-history').addEventListener('click', () => {
  localStorage.removeItem('promptHistory');
  loadHistory();
});

loadHistory();
`;

html = html.replace(
  /<\/script>/,
  `\n${scriptAdditions}\n</script>`
);

// Add saveToHistory to the fetch success
html = html.replace(
  /result\.textContent=d\.prompt;/,
  `result.textContent=d.prompt;\n    saveToHistory(text, d.prompt);`
);

fs.writeFileSync('tungston-prompt-maker/index.html', html);
