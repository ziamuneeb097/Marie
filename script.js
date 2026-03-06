const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const userInput = document.getElementById('user-input');
const typingContainer = document.getElementById('typing-container');
const progressBar = document.getElementById('progress-bar');
const typingIndicator = document.getElementById('typing');

const WEBHOOK_URL = 'https://sandboxagentml.app.n8n.cloud/webhook/b5145be0-d333-4fda-92f2-9a986ca63642';
const MAX_RETRIES = 5;         // Retry up to 5 times
const RETRY_DELAY_MS = 10000;  // Wait 10 seconds between retries

// --- PROGRESS BAR SYSTEM ---
let progressInterval;
function startProgress() {
    let width = 0;
    progressBar.style.width = '0%';

    progressInterval = setInterval(() => {
        if (width >= 95) {
            clearInterval(progressInterval);
        } else if (width < 30) {
            width += 0.5;
        } else if (width < 60) {
            width += 0.1;
        } else if (width < 90) {
            width += 0.02;
        } else {
            width += 0.005;
        }
        progressBar.style.width = width + '%';
    }, 100);
}

function completeProgress() {
    clearInterval(progressInterval);
    progressBar.style.width = '100%';
    setTimeout(() => {
        typingContainer.style.display = 'none';
        progressBar.style.width = '0%';
    }, 500);
}

// --- LOGGING SYSTEM ---
function logEvent(event, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, event, ...data };
    console.log(`[LOG] ${timestamp} - ${event}`, data);

    const logs = JSON.parse(localStorage.getItem('chat_logs') || '[]');
    logs.push(logEntry);
    if (logs.length > 100) logs.shift();
    localStorage.setItem('chat_logs', JSON.stringify(logs));
}

// Generate a fresh session ID on every refresh
let sessionId = 'session_' + Math.random().toString(36).substr(2, 9);
logEvent('SESSION_START', { sessionId });

function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(sender === 'user' ? 'user-message' : 'ai-message');
    messageDiv.innerText = text;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// --- CORE: Send message with auto-retry ---
async function sendToN8n(message, attempt = 1) {
    logEvent('FETCH_ATTEMPT', { attempt, message });
    typingIndicator.innerText = attempt === 1
        ? "Assistant is thinking..."
        : `Connection dropped. Retrying (attempt ${attempt}/${MAX_RETRIES})...`;

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: "sendMessage",
                chatInput: message,
                sessionId: sessionId
            }),
        });

        logEvent('RESPONSE_RECEIVED', { status: response.status, attempt });

        // Handle server-side timeouts (502/504) with retry
        if (response.status === 502 || response.status === 504) {
            if (attempt < MAX_RETRIES) {
                logEvent('SERVER_TIMEOUT_RETRY', { status: response.status, attempt });
                typingIndicator.innerText = `Server timed out (${response.status}). n8n is still working. Retrying in 10s... (attempt ${attempt}/${MAX_RETRIES})`;
                await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
                return sendToN8n(message, attempt + 1);
            }
            return { error: true, message: "n8n took too long to respond after multiple retries. Please check your n8n workflow." };
        }

        if (!response.ok) {
            return { error: true, message: `Server error (${response.status}). Please try again.` };
        }

        const data = await response.json();
        logEvent('DATA_PARSED', { data, attempt });
        return { error: false, data };

    } catch (error) {
        logEvent('FETCH_ERROR', { error: error.message, attempt });

        // Network error / connection dropped — RETRY
        if (attempt < MAX_RETRIES) {
            logEvent('NETWORK_RETRY', { attempt });
            typingIndicator.innerText = `Connection dropped. n8n may still be processing. Retrying in 10s... (attempt ${attempt}/${MAX_RETRIES})`;
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
            return sendToN8n(message, attempt + 1);
        }

        return { error: true, message: "Could not connect after multiple retries. n8n may still be processing — check your n8n executions." };
    }
}

// --- FORM HANDLER ---
chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = userInput.value.trim();
    if (!message) return;

    logEvent('MESSAGE_SENT', { message });
    addMessage(message, 'user');
    userInput.value = '';

    // Show progress
    typingContainer.style.display = 'block';
    startProgress();
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const startTime = Date.now();

    // Send with auto-retry
    const result = await sendToN8n(message);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logEvent('FINAL_RESULT', { duration: `${duration}s`, error: result.error });

    // Complete progress bar
    completeProgress();

    if (result.error) {
        addMessage(result.message, 'ai');
    } else {
        // Parse the n8n response
        const data = result.data;
        let aiResponse = "I'm sorry, I couldn't process that.";

        if (Array.isArray(data) && data.length > 0) {
            const firstItem = data[0];
            aiResponse = firstItem.output || firstItem.text || firstItem.response || (typeof firstItem === 'string' ? firstItem : aiResponse);
        } else {
            aiResponse = data.output || data.text || data.response || (typeof data === 'string' ? data : aiResponse);
        }

        addMessage(aiResponse, 'ai');
    }

    typingContainer.style.display = 'none';
    chatMessages.scrollTop = chatMessages.scrollHeight;
});
