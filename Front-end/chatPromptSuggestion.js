// chatPromptSuggestion.js

export default function initChatPromptSuggestion({
  inputEl,
  barEl,
  apiUrl = `${window.location.origin}/api/suggest-prompt`,
  minLength = 1
}) {
  let lastSuggestedPrompt = '';
  let lastPromptSent = '';
  let suggestController = null;

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Show the AI suggestion (debounced)
  const showAISuggestion = debounce(async function () {
    const msg = inputEl.value.trim();
    if (msg.length < minLength) {
      barEl.style.display = 'none';
      return;
    }

    if (msg === lastPromptSent) return;
    lastPromptSent = msg;

    // Cancel previous fetch if running
    if (suggestController) suggestController.abort();
    suggestController = new AbortController();

    barEl.innerHTML = `<span style="color:#666;">💡 AI prompt suggestion</span>`;
    barEl.style.display = '';

    try {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: msg }),
        signal: suggestController.signal
      });

      const data = await res.json();

      if (data.suggestion) {
        lastSuggestedPrompt = data.suggestion;
        barEl.innerHTML = `
          <span style="font-size:1em;">💡 AI Suggestion:<br>
            <em
              style="cursor:pointer;color:#2563eb;text-decoration:underline;"
              id="prompt-suggestion-link"
            >
              ${data.suggestion.replace(/"/g, "&quot;")}
            </em>
          </span>
        `;
        barEl.style.display = '';

        document.getElementById('prompt-suggestion-link').onclick = function () {
          inputEl.value = lastSuggestedPrompt;
          inputEl.focus();
          barEl.style.display = 'none';
        };
      } else {
        barEl.style.display = 'none';
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        barEl.innerHTML = `<span style="color:#e00;">(AI failed to suggest. Try again.)</span>`;
      }
    }
  }, 650);

  inputEl.addEventListener('input', showAISuggestion);
  inputEl.addEventListener('blur', function () {
    setTimeout(() => {
      barEl.style.display = 'none';
    }, 100);
  });
}
