function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const API_BASE = 'http://localhost:3000';
const token = localStorage.getItem('authToken');
// Only redirect to login if not viewing a shared thread
const urlParams = new URLSearchParams(window.location.search);
const shareId = urlParams.get('share');
if (!token && !shareId) window.location.href = "login.html";

function getFullAvatarUrl(url) {
  if (!url) return '';
  if (url.startsWith('/')) return API_BASE + url;
  return url;
}

// Sidebar/theme logic
const sidebar = document.getElementById('sidebar');
const mainChat = document.getElementById('main-chat');
const mainChatInner = document.getElementById('main-chat-inner');
const toggleBtn = document.getElementById('sidebar-toggle-btn');
const showSidebarBtn = document.getElementById('show-sidebar-btn');
const themeToggle = document.getElementById('theme-toggle');
const themeSwitchText = document.getElementById('theme-switch-text');

// Chat state
let chatHistory = [];
let sessionId = localStorage.getItem('sessionId') || null;
let userId = null;
let pendingUploads = [];
let typingIndicatorEl = null;
let socket;
let userName = '';
let userEmail = '';

// DOM refs
const messagesEl = document.getElementById('messages');
const introEl = document.getElementById('intro');
const tagsEl = document.getElementById('tag-container');
const inputEl = document.getElementById('chat-input');
const fileInput = document.getElementById('file-upload');
const previewContainer = document.getElementById('file-preview-container');
const chatHistoryEl = document.getElementById('chat-history');
const sendBtn = document.getElementById('send-btn');
const suggestionBar = document.getElementById('promptara-suggestion-bar');
const neonContainer = document.querySelector('.promptara-neon-container'); // Neon frame container

// =================== REST OF CHAT LOGIC ===================

inputEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = (this.scrollHeight) + 'px';
});

if (sendBtn) {
  sendBtn.addEventListener('click', function (e) {
    e.preventDefault();
    sendMessage();
  });
}
function setMainChatCentered(center) {
  if (center) {
    mainChat.classList.add('center-content');
    mainChatInner.style.display = 'flex';
  } else {
    mainChat.classList.remove('center-content');
    mainChatInner.style.display = 'none';
  }
}
toggleBtn.onclick = function () {
  sidebar.classList.add('hide');
  mainChat.classList.add('full');
  showSidebarBtn.style.display = 'flex';
  setTimeout(() => { sidebar.style.display = 'none'; }, 300);
};
showSidebarBtn.onclick = function () {
  sidebar.style.display = '';
  setTimeout(() => {
    sidebar.classList.remove('hide');
    mainChat.classList.remove('full');
    showSidebarBtn.style.display = 'none';
  }, 5);
};
window.addEventListener('resize', function () {
  if (window.innerWidth < 700) {
    sidebar.classList.add('hide');
    mainChat.classList.add('full');
    showSidebarBtn.style.display = 'flex';
  } else {
    sidebar.classList.remove('hide');
    mainChat.classList.remove('full');
    showSidebarBtn.style.display = 'none';
  }
});
window.dispatchEvent(new Event('resize'));

function loadTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  if (savedTheme === 'light') {
    document.body.classList.add('light');
    themeToggle.checked = true;
    themeSwitchText.textContent = 'Light';
  } else {
    document.body.classList.remove('light');
    themeToggle.checked = false;
    themeSwitchText.textContent = 'Dark';
  }
}
themeToggle.addEventListener('change', () => {
  if (themeToggle.checked) {
    document.body.classList.add('light');
    themeSwitchText.textContent = 'Light';
    localStorage.setItem('theme', 'light');
  } else {
    document.body.classList.remove('light');
    themeSwitchText.textContent = 'Dark';
    localStorage.setItem('theme', 'dark');
  }
});
loadTheme();

function resetChatUI() {
  messagesEl.innerHTML = '';
  mainChatInner.style.display = 'flex';
  setMainChatCentered(true);
  introEl.style.display = '';
  tagsEl.style.display = '';
  messagesEl.style.display = 'none';
  inputEl.value = '';
  inputEl.disabled = false;
  previewContainer.innerHTML = '';
  pendingUploads = [];
}

async function fetchChatHistory() {
  try {
    const res = await fetch(`${API_BASE}/api/conversations`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    chatHistory = data.conversations || [];
    if (!sessionId && chatHistory.length > 0) {
      sessionId = chatHistory[0].session_id;
      localStorage.setItem('sessionId', sessionId);
    }
    renderChatHistory();
  } catch {
    chatHistory = [];
    sessionId = null;
    renderChatHistory();
  }
}
async function fetchProfile() {
  try {
    const res = await fetch(`${API_BASE}/api/profile`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const avatarDiv = document.getElementById('userAvatar');
    const nameSpan = document.getElementById('userFullName');
    if (avatarDiv && nameSpan) {
      nameSpan.textContent = (data.first_name && data.last_name)
        ? data.first_name + ' ' + data.last_name
        : (data.first_name || data.last_name || 'User');

      avatarDiv.innerHTML = '';
      if (data.profile_photo_url) {
        const img = document.createElement('img');
        img.src = getFullAvatarUrl(data.profile_photo_url) + '?t=' + Date.now();
        img.alt = "Profile Photo";
        avatarDiv.appendChild(img);
      } else {
        let initials = '';
        if (data.first_name) initials += data.first_name[0];
        if (data.last_name) initials += data.last_name[0];
        initials = initials.toUpperCase() || '?';
        avatarDiv.textContent = initials;
      }
    }
    userId = data.id;
    userName = `${data.first_name} ${data.last_name}`;
    userEmail = data.email;
  } catch {
    const acc = document.getElementById('account-info');
    if (acc) acc.textContent = "Unknown User";
  }
}
window.addEventListener('storage', function(e) {
  if (e.key === 'profileUpdated' && e.newValue) {
    fetchProfile();
  }
});

function renderChatHistory() {
  chatHistoryEl.innerHTML = '';
  chatHistory.forEach(({ session_id, title }, index) => {
    const div = document.createElement('div');
    div.className = 'chat-history-item';
    div.tabIndex = 0;
    div.setAttribute('role', 'listitem');
    if (session_id === sessionId) div.classList.add('active');
    div.dataset.sessionId = session_id;

    const span = document.createElement('span');
    span.className = 'chat-history-item-title';
    if (title && title.trim()) {
      span.textContent = title;
      span.title = title;
    } else if (chatHistory[index].first_message) {
      let msg = chatHistory[index].first_message.split(' ').slice(0, 7).join(' ');
      span.textContent = msg + (chatHistory[index].first_message.split(' ').length > 7 ? 'â€¦' : '');
      span.title = chatHistory[index].first_message;
    } else {
      span.textContent = `Chat ${index + 1}`;
      span.title = `Chat ${index + 1}`;
    }
    span.onclick = () => selectChat(session_id);
    span.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectChat(session_id);
      }
    };

    const menuBtn = document.createElement('button');
    menuBtn.className = 'chat-menu-btn';
    menuBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    `;
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      showChatMenu(div, session_id, span.textContent.trim(), menuBtn);
    };

    div.appendChild(span);
    div.appendChild(menuBtn);
    chatHistoryEl.appendChild(div);
  });
}

function showChatMenu(parentDiv, session_id, currentTitle, triggerBtn) {
  document.querySelectorAll('.chat-context-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'chat-context-menu glassy';

  const rename = document.createElement('div');
  rename.className = 'chat-context-menu-item';
  rename.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="margin-right:8px;vertical-align:middle;">
      <path d="M15.013 3.874a1.562 1.562 0 1 1 2.211 2.211l-9.11 9.11-2.797.586a.469.469 0 0 1-.55-.55l.587-2.797 9.11-9.11ZM13.553 5.333l1.114 1.114M5.4 16.6H17"
        stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    Rename chat
  `;
  rename.onclick = (e) => {
    e.stopPropagation();
    menu.remove();

    const chatItem = parentDiv;
    const titleSpan = chatItem.querySelector('.chat-history-item-title');
    if (!titleSpan) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = titleSpan.textContent;
    input.style.width = (titleSpan.offsetWidth + 20) + 'px';
    input.style.fontSize = 'inherit';
    input.style.padding = '2px 7px';
    input.style.borderRadius = '7px';
    input.style.border = '1px solid #aaa';
    input.style.outline = 'none';
    input.style.background = '#fff';
    input.style.color = '#222';

    titleSpan.style.display = 'none';
    chatItem.insertBefore(input, titleSpan);

    input.focus();
    input.select();

    input.addEventListener('keydown', function(evt) {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        submitRename();
      } else if (evt.key === 'Escape') {
        input.remove();
        titleSpan.style.display = '';
      }
    });
    input.addEventListener('blur', submitRename);

    function submitRename() {
      const newName = input.value.trim();
      input.remove();
      titleSpan.style.display = '';
      if (newName && newName !== currentTitle) {
        renameConversation(session_id, newName);
      }
    }
  };

  const del = document.createElement('div');
  del.className = 'chat-context-menu-item danger';
  del.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="margin-right:8px;vertical-align:middle;">
      <rect x="5" y="7" width="10" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/>
      <rect x="8" y="4" width="4" height="2" rx="1" stroke="currentColor" stroke-width="1.5"/>
      <line x1="4" y1="7" x2="16" y2="7" stroke="currentColor" stroke-width="1.5"/>
      <line x1="8" y1="10" x2="8" y2="14" stroke="currentColor" stroke-width="1.5"/>
      <line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" stroke-width="1.5"/>
    </svg>
    Delete chat
  `;
  del.onclick = (e) => {
    e.stopPropagation();
    menu.remove();
    deleteConversation(session_id);
  };

  menu.appendChild(rename);
  menu.appendChild(del);

  const btnRect = triggerBtn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = btnRect.left + 'px';
  menu.style.top = (btnRect.bottom + 6) + 'px';
  menu.style.zIndex = 2000;
  menu.style.minWidth = btnRect.width + 80 + 'px';

  document.body.appendChild(menu);

  setTimeout(() => {
    function closeHandler(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        window.removeEventListener('mousedown', closeHandler);
      }
    }
    window.addEventListener('mousedown', closeHandler);
  }, 10);
}

async function renameConversation(session_id, newTitle) {
  try {
    const res = await fetch(`${API_BASE}/api/conversation/${session_id}/title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ title: newTitle })
    });
    if (res.ok) {
      const chat = chatHistory.find(c => c.session_id === session_id);
      if (chat) chat.title = newTitle;
      renderChatHistory();
    } else {
      alert("Failed to rename conversation.");
    }
  } catch {
    alert("Failed to rename conversation.");
  }
}

function selectChat(id) {
  if (id === sessionId) return;
  sessionId = id;
  localStorage.setItem('sessionId', sessionId);
  loadMessagesForCurrentSession();
  renderChatHistory();
  connectSocket();
}

async function deleteConversation(session_id) {
  if (!confirm("Delete this conversation?")) return;
  try {
    await fetch(`${API_BASE}/api/conversation/${session_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    chatHistory = chatHistory.filter(c => c.session_id !== session_id);
    if (sessionId === session_id) {
      if (chatHistory.length > 0) {
        sessionId = chatHistory[0].session_id;
        localStorage.setItem('sessionId', sessionId);
      } else {
        sessionId = null;
        localStorage.removeItem('sessionId');
      }
    }
    renderChatHistory();
    loadMessagesForCurrentSession();
  } catch {
    alert("Failed to delete conversation.");
  }
}

document.getElementById('new-chat-btn').onclick = async () => {
  sessionId = generateUUID();
  localStorage.setItem('sessionId', sessionId);
  resetChatUI();
  inputEl.focus();
  connectSocket();
};

function wrapBotTablesInScroll() {
  document.querySelectorAll('.bot table').forEach(table => {
    if (!table.parentElement.classList.contains('table-scroll-x')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll-x';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  });
}

function makeBotTablesResponsive() {
  document.querySelectorAll('.bot table').forEach(table => {
    const headers = Array.from(table.querySelectorAll('th')).map(th => th.innerText.trim());
    table.querySelectorAll('tr').forEach(tr => {
      tr.querySelectorAll('td').forEach((td, i) => {
        td.setAttribute('data-label', headers[i] || '');
      });
    });
  });
}

function appendMessage(role, content) {
  setMainChatCentered(false);
  messagesEl.style.display = 'flex';
  const div = document.createElement('div');
  div.className = `message ${role} glassy`;

  if (role === 'bot') {
    div.innerHTML = marked.parse(content);

    messagesEl.appendChild(div);

    setTimeout(() => {
      div.querySelectorAll('a[href*="/uploads/"]').forEach(link => {
        let fileName = link.textContent.split('Download')[1]?.trim() || '';
        if (!fileName) {
          const urlParts = link.href.split('/');
          fileName = urlParts[urlParts.length - 1];
        }
        link.setAttribute('download', fileName);
        if (!link.textContent.trim().startsWith('ðŸ“„')) {
          // link.innerHTML = 'ðŸ“„ ' + link.innerHTML;
          link.innerHTML = link.innerHTML;
        }
      });
    }, 0);

    wrapBotTablesInScroll();

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = formatTimestamp(new Date());
    div.appendChild(timestampSpan);

    makeBotTablesResponsive();
    if (content.includes('LifeCode Protocol') || content.includes('Situation Overview')) {
      showROIPrompt(sessionId, null, div);
    }
  } else {
    div.textContent = content;
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = formatTimestamp(new Date());
    div.appendChild(timestampSpan);
    messagesEl.appendChild(div);
  }

  const actions = document.createElement('div');
  actions.className = 'message-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'icon-btn copy-btn';
  copyBtn.title = 'Copy';
  copyBtn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
      <rect x="6" y="6" width="9" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
      <rect x="9" y="3" width="9" height="11" rx="2" stroke="currentColor" stroke-width="1.8"/>
    </svg>
  `;
  copyBtn.onclick = async function (e) {
    e.stopPropagation();
    let textToCopy, htmlToCopy;
    if (role === 'bot') {
      const clone = div.cloneNode(true);
      const ts = clone.querySelector('.timestamp');
      if (ts) ts.remove();
      htmlToCopy = clone.innerHTML;
      textToCopy = clone.innerText.trim();
    } else {
      textToCopy = content;
      htmlToCopy = content;
    }
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        const blobHtml = new Blob([htmlToCopy], { type: "text/html" });
        const blobText = new Blob([textToCopy], { type: "text/plain" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": blobHtml,
            "text/plain": blobText
          })
        ]);
      } else {
        await navigator.clipboard.writeText(textToCopy);
      }
      copyBtn.classList.add('copied');
      copyBtn.title = "Copied!";
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.title = "Copy";
      }, 1200);
    } catch (err) {
      alert('Copy failed: ' + (err.message || err));
    }
  };

  const likeBtn = document.createElement('button');
  likeBtn.className = 'icon-btn like-btn';
  likeBtn.title = 'Like';
  likeBtn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
      <path d="M7.5 17.5V8.5a1 1 0 0 1 1-1H13.7a1.5 1.5 0 0 1 1.45 1.87l-1.07 4.13a2 2 0 0 1-1.93 1.5H8.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="4.5" y="8.5" width="3" height="9" rx="1" stroke="currentColor" stroke-width="1.8"/>
    </svg>
  `;

  const dislikeBtn = document.createElement('button');
  dislikeBtn.className = 'icon-btn dislike-btn';
  dislikeBtn.title = 'Dislike';
  dislikeBtn.innerHTML = `
    <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
      <path d="M12.5 2.5v9a1 1 0 0 1-1 1H6.3A1.5 1.5 0 0 1 4.85 10.6l1.07-4.13A2 2 0 0 1 7.85 5h3.7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="12.5" y="2.5" width="3" height="9" rx="1" stroke="currentColor" stroke-width="1.8"/>
    </svg>
  `;

  actions.appendChild(copyBtn);
  actions.appendChild(likeBtn);
  actions.appendChild(dislikeBtn);

  div.insertAdjacentElement('afterend', actions);
  div.scrollIntoView({ behavior: 'smooth', block: role === 'bot' ? 'start' : 'end' });
}

function showROIPrompt(conversation_id, life_code_id, afterElem = null) {
  const oldPrompt = document.getElementById('roi-feedback');
  if (oldPrompt) oldPrompt.remove();
  const roiDiv = document.createElement('div');
  roiDiv.id = 'roi-feedback';
  roiDiv.className = 'glassy';
  roiDiv.style.margin = '12px 0 20px 0';
  roiDiv.innerHTML = `
    <label style="font-weight:600;">Did this help you? Share your result:</label><br>
    <input id="roi-result" type="text" style="width:60%;margin:8px 0;" placeholder="e.g. +500 subs, â‚±8000 sales" />
    <input id="roi-value" type="number" style="width:32%;margin:8px 0;" placeholder="Numeric value (optional)" />
    <button id="roi-submit" style="margin-left:10px;">Report Result</button>
  `;
  if (afterElem) {
    afterElem.insertAdjacentElement('afterend', roiDiv);
  } else {
    messagesEl.appendChild(roiDiv);
  }

  document.getElementById('roi-submit').onclick = async () => {
    const reported_result = document.getElementById('roi-result').value.trim();
    const roi_value = document.getElementById('roi-value').value || null;
    if (!reported_result) return alert('Please enter your result.');
    const res = await fetch(`${API_BASE}/api/report-outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        conversation_id,
        life_code_id,
        reported_result,
        roi_value
      })
    });
    if (res.ok) {
      alert('Thank you! Your result was recorded.');
      roiDiv.remove();
    } else {
      alert('Failed to report result.');
    }
  };
}

function useTag(text) { inputEl.value = text; inputEl.focus(); }
fileInput.addEventListener('change', (event) => {
  const files = Array.from(event.target.files);
  if (!files.length) return;
  files.forEach(file => pendingUploads.push(file));
  renderFilePreviews();
  fileInput.value = '';
});

function renderFilePreviews() {
  previewContainer.innerHTML = '';
  pendingUploads.forEach((file, index) => {
    const previewDiv = document.createElement('div');
    previewDiv.className = 'file-preview-inline';
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'X';
    removeBtn.onclick = () => { pendingUploads.splice(index, 1); renderFilePreviews(); };
    previewDiv.appendChild(removeBtn);
    const lowerName = file.name.toLowerCase();
    function getIconSrc() {
      if (file.type.startsWith('image/')) return URL.createObjectURL(file);
      if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) return 'https://cdn-icons-png.flaticon.com/512/337/337946.png';
      if (file.type === 'application/msword' || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || lowerName.endsWith('.doc') || lowerName.endsWith('.docx')) return 'https://cdn-icons-png.flaticon.com/512/888/888857.png';
      if (file.type === 'application/vnd.ms-excel' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx')) return 'https://cdn-icons-png.flaticon.com/512/888/888859.png';
      if (file.type === 'application/vnd.ms-powerpoint' || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || lowerName.endsWith('.ppt') || lowerName.endsWith('.pptx')) return 'https://cdn-icons-png.flaticon.com/512/888/888858.png';
      if (file.type === 'text/plain' || lowerName.endsWith('.txt') || lowerName.endsWith('.csv') || lowerName.endsWith('.log')) return 'https://cdn-icons-png.flaticon.com/512/136/136539.png';
      return 'https://cdn-icons-png.flaticon.com/512/109/109612.png';
    }
    const iconSrc = getIconSrc();
    const img = document.createElement('img');
    img.src = iconSrc;
    img.className = 'icon';
    if (file.type.startsWith('image/')) { img.onload = () => { URL.revokeObjectURL(img.src); }; }
    previewDiv.appendChild(img);
    const label = document.createElement('span');
    label.textContent = file.name;
    previewDiv.appendChild(label);
    previewContainer.appendChild(previewDiv);
  });
}
function showTyping() {
  if (!typingIndicatorEl) {
    typingIndicatorEl = document.createElement('div');
    typingIndicatorEl.className = 'typing';
    typingIndicatorEl.textContent = 'Defizer is thinking';
    messagesEl.appendChild(typingIndicatorEl);
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }
}
function hideTyping() {
  if (typingIndicatorEl && messagesEl.contains(typingIndicatorEl)) {
    messagesEl.removeChild(typingIndicatorEl);
    typingIndicatorEl = null;
  } else if (typingIndicatorEl) {
    typingIndicatorEl = null;
  }
}
function formatTimestamp(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function sendMessage() {
  const message = inputEl.value.trim();
  if (!message && pendingUploads.length === 0) return;
  if (!sessionId) {
    sessionId = generateUUID();
    localStorage.setItem('sessionId', sessionId);
  }
  inputEl.disabled = true;

  if (message) appendMessage('user', message);

  if (pendingUploads.length > 0) {
    const formData = new FormData();
    formData.append('message', message);
    formData.append('sessionId', sessionId);
    pendingUploads.forEach(file => formData.append('files', file));
    pendingUploads.forEach(file => appendMessage('user', `[File] ${file.name}`));
    showTyping();

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      hideTyping();
      const data = await res.json();
      if (res.ok) {
        appendMessage('bot', data.reply);
      } else {
        appendMessage('bot', data.error || "Error analyzing file and message.");
      }
    } catch {
      hideTyping();
      appendMessage('bot', 'Failed to upload or analyze file.');
    }
    pendingUploads = [];
    renderFilePreviews();
  } else if (message) {
    showTyping();
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId, message })
      });
      hideTyping();
      const data = await res.json();
      if (res.ok) {
        appendMessage('bot', data.reply);
      } else {
        appendMessage('bot', data.error || "Error sending message.");
      }
    } catch (err) {
      hideTyping();
      appendMessage('bot', 'Network error.');
    }
  }

  inputEl.value = '';
  inputEl.disabled = false;
  inputEl.focus();
  await fetchChatHistory();
}

async function loadMessagesForCurrentSession() {
  messagesEl.innerHTML = '';
  if (!sessionId) return;
  try {
    const res = await fetch(`${API_BASE}/api/messages?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    (data.messages || []).forEach(msg => {
      appendMessage(msg.sender, msg.message);
    });
    setMainChatCentered(false);
    messagesEl.style.display = 'flex';
  } catch {
    appendMessage('bot', "Could not load messages.");
  }
}

function connectSocket() {
  if (socket) socket.disconnect();
  if (!sessionId && !userId) return;
  socket = io(API_BASE, {
    query: {
      sessionId: sessionId || '',
      userId: userId || ''
    }
  });
  socket.on('operator_reply', (data) => {
    appendMessage('bot', data.message);
  });
}

async function loadSharedThread(shareId) {
  try {
    // Hide sidebar and input for shared view
    const sidebar = document.getElementById('sidebar');
    const inputArea = document.querySelector('.input-area');
    const shareBtn = document.getElementById('share-chat-btn');
    
    if (sidebar) sidebar.style.display = 'none';
    if (inputArea) inputArea.style.display = 'none';
    if (shareBtn) shareBtn.style.display = 'none';
    
    // Show shared thread indicator
    const messagesEl = document.getElementById('messages');
    const introEl = document.getElementById('intro');
    const tagsEl = document.getElementById('tag-container');
    
    // Hide intro and tags
    if (introEl) introEl.style.display = 'none';
    if (tagsEl) tagsEl.style.display = 'none';
    
    // Add shared thread header
    const sharedHeader = document.createElement('div');
    sharedHeader.className = 'shared-thread-header glassy';
    sharedHeader.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; padding: 16px 20px; margin-bottom: 20px;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style="color: #00d4ff;">
          <path d="M15 8V5a3 3 0 0 0-6 0v3M5 10V5a5 5 0 0 1 10 0v5a5 5 0 1 1-2.99-4.57" stroke="currentColor" stroke-width="2" fill="none"/>
        </svg>
        <div>
          <h3 style="margin: 0; color: #00d4ff; font-size: 1.2em;">Shared Chat Thread</h3>
          <p style="margin: 4px 0 0 0; color: #888; font-size: 0.9em;">Viewing a shared conversation</p>
        </div>
      </div>
    `;
    messagesEl.parentNode.insertBefore(sharedHeader, messagesEl);
    
    // Fetch shared thread data
    const res = await fetch(`${API_BASE}/api/shared-thread/${shareId}`);
    
    if (!res.ok) {
      if (res.status === 404) {
        appendMessage('bot', "❌ Shared thread not found. The link may be invalid or expired.");
      } else if (res.status === 403) {
        appendMessage('bot', "🔒 This shared thread is private and not accessible.");
      } else {
        appendMessage('bot', "❌ Error loading shared thread. Please try again later.");
      }
      return;
    }
    
    const data = await res.json();
    
    // Display shared thread title
    if (data.title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'shared-thread-title glassy';
      titleEl.innerHTML = `
        <div style="padding: 12px 20px; margin-bottom: 16px; text-align: center;">
          <h2 style="margin: 0; color: var(--color-text); font-size: 1.4em;">${data.title}</h2>
          ${data.created_at ? `<p style="margin: 4px 0 0 0; color: #888; font-size: 0.85em;">Shared on ${new Date(data.created_at).toLocaleDateString()}</p>` : ''}
        </div>
      `;
      messagesEl.parentNode.insertBefore(titleEl, messagesEl);
    }
    
    // Display messages
    messagesEl.style.display = 'flex';
    setMainChatCentered(false);
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(msg => {
        appendMessage(msg.sender, msg.message);
      });
    } else {
      appendMessage('bot', "This shared thread appears to be empty.");
    }
    
  } catch (err) {
    console.error('Error loading shared thread:', err);
    appendMessage('bot', "❌ Failed to load shared thread. Please check the link and try again.");
  }
}

(async function init() {
  // Check for share parameter in URL (already parsed above)
  if (shareId) {
    // Load shared thread
    await loadSharedThread(shareId);
  } else {
    // Normal initialization for logged-in users
    await fetchProfile();
    await fetchChatHistory();
    if (!sessionId && chatHistory.length > 0) {
      sessionId = chatHistory[0].session_id;
      localStorage.setItem('sessionId', sessionId);
    }
    connectSocket();
    setMainChatCentered(true);
    if (sessionId) await loadMessagesForCurrentSession();
  }
})();

document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('theme');
  localStorage.removeItem('sessionId');
  window.location = 'login.html';
};

document.getElementById('share-chat-btn').onclick = async function () {
  if (!sessionId) return alert("No chat selected to share.");
  
  // Show privacy selection dialog
  const isPublic = confirm("Make this share public?\n\n• Click OK for PUBLIC (anyone with link can view)\n• Click Cancel for PRIVATE (only you can view)");
  
  try {
    const res = await fetch(`${API_BASE}/api/share-thread`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ 
        session_id: sessionId,
        is_public: isPublic
      })
    });
    let data;
    try {
      data = await res.json();
      console.log("[SHARE DEBUG] Received response:", data);
    } catch (jsonErr) {
      const text = await res.text();
      console.error("[SHARE DEBUG] Failed to parse JSON. Raw text:", text);
      return alert("Share error (bad response): " + text);
    }
    if (data && data.shareId) {
      const shareUrl = `${window.location.origin}/chat.html?share=${data.shareId}`;
      const privacyText = isPublic ? "PUBLIC" : "PRIVATE";
      
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        alert(`✅ ${privacyText} share link copied to clipboard!\n\n${shareUrl}\n\n${isPublic ? 'Anyone with this link can view your chat.' : 'Only you can access this link.'}`);
      } else {
        prompt(`Copy this ${privacyText} share link:`, shareUrl);
      }
    } else {
      alert(data && data.error || "Failed to create share link.");
    }
  } catch (e) {
    alert("Error creating share link: " + e.message);
  }
};

// === ACCOUNT DROPDOWN MENU LOGIC ===
document.addEventListener('DOMContentLoaded', function () {
  const menuBtn = document.getElementById('accountMenuBtn');
  const menuDropdown = document.getElementById('accountMenuDropdown');

  if (menuBtn && menuDropdown) {
    menuBtn.onclick = function(e) {
      const isOpen = menuDropdown.style.display === 'block';
      menuDropdown.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        const btnRect = menuBtn.getBoundingClientRect();
        const menuHeight = menuDropdown.offsetHeight || 160;
        const spaceBelow = window.innerHeight - btnRect.bottom;
        if (spaceBelow < menuHeight + 20) {
          menuDropdown.classList.add('upwards');
          menuDropdown.style.top = 'auto';
          menuDropdown.style.bottom = (btnRect.height + 8) + 'px';
        } else {
          menuDropdown.classList.remove('upwards');
          menuDropdown.style.top = (btnRect.height + 6) + 'px';
          menuDropdown.style.bottom = 'auto';
        }
      }
      e.stopPropagation();
    };

    document.addEventListener('click', function(e) {
      if (menuDropdown.style.display === 'block' && !menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.style.display = 'none';
      }
    });

    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.onclick = function(e) {
        e.preventDefault();
        alert("Upgrade feature coming soon!");
      };
    }

    const helpBtn = document.getElementById('helpBtn');
    if (helpBtn) {
      helpBtn.onclick = function(e) {
        e.preventDefault();
        window.open('mailto:support@defizerdevelopment.com?subject=Need%20Help%20with%20Defizer');
      };
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = function(e) {
        e.preventDefault();
        localStorage.removeItem('authToken');
        localStorage.removeItem('theme');
        localStorage.removeItem('sessionId');
        window.location = 'login.html';
      };
    }
  }
});

// ======= PROMPTARA CLOUD SUGGESTION: OPTION B (Suggestion inside cloud shape) =======
let lastPrompt = '';
let debounceTimer = null;
let typewriterInterval = null;

function typewriterEffect(element, text, speed = 30) {
  // Clear any existing typewriter animation
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }
  
  element.textContent = '';
  let charIndex = 0;
  
  typewriterInterval = setInterval(() => {
    if (charIndex < text.length) {
      element.textContent += text.charAt(charIndex);
      charIndex++;
    } else {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
  }, speed);
}

function showPromptaraSuggestion(suggestion) {
  suggestionBar.title = suggestion;
  suggestionBar.style.cursor = "pointer";
  // Add attention-grabbing neon pulse animation
  if (neonContainer) {
    neonContainer.classList.add('has-suggestion');
  }
  // Show the suggestion with typewriter effect
  typewriterEffect(suggestionBar, suggestion, 30);
}

function clearPromptaraSuggestion() {
  if (typewriterInterval) {
    clearInterval(typewriterInterval);
    typewriterInterval = null;
  }
  // Remove neon pulse animation
  if (neonContainer) {
    neonContainer.classList.remove('has-suggestion');
  }
  suggestionBar.textContent = '';
  suggestionBar.removeAttribute('title');
  suggestionBar.style.cursor = "default";
}

inputEl.addEventListener('input', function () {
  const val = inputEl.value.trim();
  if (!val) {
    clearPromptaraSuggestion();
    lastPrompt = '';
    return;
  }
  if (val === lastPrompt) return;
  lastPrompt = val;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    // Clear any running typewriter animation
    if (typewriterInterval) {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
    suggestionBar.textContent = "Loading...";
    try {
      const res = await fetch('http://localhost:3000/api/suggest-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: val })
      });
      const data = await res.json();
      if (data && data.suggestion) showPromptaraSuggestion(data.suggestion);
      else clearPromptaraSuggestion();
    } catch {
      clearPromptaraSuggestion();
    }
  }, 450);
});

suggestionBar.onclick = function() {
  if (suggestionBar.textContent && suggestionBar.textContent !== "Loading...") {
    // Stop the typewriter animation if still running
    if (typewriterInterval) {
      clearInterval(typewriterInterval);
      typewriterInterval = null;
    }
    
    // Remove neon pulse animation immediately
    if (neonContainer) {
      neonContainer.classList.remove('has-suggestion');
    }
    
    // Get the full suggestion text (use title attribute which has the complete text)
    const suggestionText = suggestionBar.title || suggestionBar.textContent.trim();
    
    // Set input value and send immediately
    inputEl.value = suggestionText;
    clearPromptaraSuggestion();
    sendMessage();
  }
};

// New Project Modal Functionality
document.getElementById('new-project-btn').onclick = () => {
  const modal = document.getElementById('project-modal-overlay');
  const input = document.getElementById('project-name-input');
  const createBtn = document.getElementById('project-modal-create');
  
  modal.style.display = 'flex';
  input.value = '';
  input.focus();
  createBtn.disabled = false;
  createBtn.textContent = 'Create Project';
};

// Close modal functions
function closeProjectModal() {
  const modal = document.getElementById('project-modal-overlay');
  modal.style.display = 'none';
}

document.getElementById('project-modal-close').onclick = closeProjectModal;
document.getElementById('project-modal-cancel').onclick = closeProjectModal;

// Close modal when clicking overlay
document.getElementById('project-modal-overlay').onclick = (e) => {
  if (e.target === e.currentTarget) {
    closeProjectModal();
  }
};

// Create project functionality
document.getElementById('project-modal-create').onclick = async () => {
  const input = document.getElementById('project-name-input');
  const createBtn = document.getElementById('project-modal-create');
  const projectName = input.value.trim();
  
  if (!projectName) {
    alert('Please enter a project name.');
    input.focus();
    return;
  }
  
  if (projectName.length < 2) {
    alert('Project name must be at least 2 characters long.');
    input.focus();
    return;
  }
  
  createBtn.disabled = true;
  createBtn.textContent = 'Creating...';
  
  try {
    // Create new project via API
    const token = localStorage.getItem('authToken');
    if (!token) {
      alert('Please log in to create projects');
      createBtn.disabled = false;
      createBtn.textContent = 'Create Project';
      return;
    }
    
    const response = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name: projectName })
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Close modal
      closeProjectModal();
      
      // Show success message
      alert(`Project "${projectName}" created successfully!`);
    } else {
      const errorData = await response.json();
      alert(`Failed to create project: ${errorData.error}`);
      createBtn.disabled = false;
      createBtn.textContent = 'Create Project';
    }
    
  } catch (error) {
    console.error('Error creating project:', error);
    alert('Failed to create project. Please try again.');
    createBtn.disabled = false;
    createBtn.textContent = 'Create Project';
  }
};

// Handle Enter key in project name input
document.getElementById('project-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('project-modal-create').click();
  }
});

// Projects Section Functionality
let projectsExpanded = false;

// Toggle projects section
document.getElementById('projects-toggle-btn').onclick = () => {
  const content = document.getElementById('projects-content');
  const toggleBtn = document.getElementById('projects-toggle-btn');
  
  projectsExpanded = !projectsExpanded;
  content.style.display = projectsExpanded ? 'block' : 'none';
  toggleBtn.classList.toggle('expanded', projectsExpanded);
};

// Delete All Chats functionality
document.getElementById('delete-all-chats-btn').onclick = async () => {
  if (chatHistory.length === 0) {
    alert("No chats to delete.");
    return;
  }
  
  const confirmMessage = `Are you sure you want to delete ALL ${chatHistory.length} chat conversations?\n\nThis action cannot be undone.`;
  if (!confirm(confirmMessage)) return;
  
  try {
    const token = localStorage.getItem('authToken');
    if (!token) {
      alert('Please log in to delete chats');
      return;
    }
    
    // Delete all conversations for this user
    const res = await fetch(`${API_BASE}/api/delete-all-conversations`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.ok) {
      // Clear local state
      chatHistory = [];
      sessionId = null;
      localStorage.removeItem('sessionId');
      
      // Reset UI
      resetChatUI();
      renderChatHistory();
      
      alert("All chat conversations have been deleted successfully.");
    } else {
      const errorData = await res.json();
      alert("Failed to delete conversations: " + (errorData.error || "Unknown error"));
    }
  } catch (err) {
    console.error('Delete all chats error:', err);
    alert("Failed to delete conversations. Please try again.");
  }
};
