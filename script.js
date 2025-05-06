const configScreen = document.getElementById('config-screen');
const chatScreen = document.getElementById('chat-screen');
const jmeterPathInput = document.getElementById('jmeter-path');
const openaiKeyInput = document.getElementById('openai-key');
const saveConfigButton = document.getElementById('save-config');
const configError = document.getElementById('config-error');

const chatbox = document.getElementById('chatbox');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-button');
const chatError = document.getElementById('chat-error');
const settingsButton = document.getElementById('settings-button'); // Get settings button
const clearChatButton = document.getElementById('clear-chat-button'); // Get clear chat button
// const checkStatusButton = document.getElementById('check-status-button'); // Removed status button reference
const statusArea = document.getElementById('status-area'); // Get status display area

let jmeterPath = localStorage.getItem('jmeterPath');
let openaiKey = localStorage.getItem('openaiKey');

// --- Configuration Handling ---

async function saveConfig() { // Make async to handle fetch
    const path = jmeterPathInput.value.trim();
    const key = openaiKeyInput.value.trim();
    configError.textContent = ''; // Clear previous errors

    if (!path || !key) {
        configError.textContent = 'Both JMeter path and OpenAI key are required.';
        return;
    }

    // Validate configuration with the backend
    try {
        const response = await fetch('/validate_config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jmeter_path: path, openai_key: key }),
        });

        const results = await response.json();

        if (!response.ok) {
            throw new Error(results.error || 'Validation request failed');
        }

        let errors = [];
        if (!results.jmeter_valid) {
            errors.push(`JMeter Path Error: ${results.jmeter_error || 'Invalid path or permissions.'}`);
        }
        if (!results.openai_valid) {
            errors.push(`OpenAI Key Error: ${results.openai_error || 'Invalid key.'}`);
        }

        if (errors.length > 0) {
            configError.textContent = errors.join(' ');
            return; // Stop if validation fails
        }

        // Validation successful, save and proceed
        localStorage.setItem('jmeterPath', path);
        localStorage.setItem('openaiKey', key);
        jmeterPath = path;
        openaiKey = key;
        showChatScreen();

    } catch (error) {
        console.error('Error validating config:', error);
        configError.textContent = `Error validating: ${error.message}`;
    }
}

function showConfigScreen() {
    configScreen.style.display = 'block';
    chatScreen.style.display = 'none';
    // Pre-fill inputs when showing config screen for editing
    jmeterPathInput.value = localStorage.getItem('jmeterPath') || '';
    openaiKeyInput.value = localStorage.getItem('openaiKey') || '';
    // Stop polling when going back to config screen
    if (statusIntervalId) {
        clearInterval(statusIntervalId);
        statusIntervalId = null;
    }
}

let statusIntervalId = null; // Variable to hold the interval ID
let lastShownAnalyzedError = null; // Track the last analyzed error shown in chat

function showChatScreen() {
    configScreen.style.display = 'none';
    chatScreen.style.display = 'block';
    // Start polling when chat screen is shown
    if (!statusIntervalId) {
        checkJMeterStatus(); // Check status immediately when switching to chat
        statusIntervalId = setInterval(checkJMeterStatus, 5000); // Poll every 5 seconds
    }
}

// --- Chat Handling ---

// Modified addMessage to accept an optional 'isTechnical' flag
function addMessage(message, sender, isTechnical = false) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    if (sender === 'user') {
        messageDiv.classList.add('user-message');
    } else {
        messageDiv.classList.add('bot-message');
        if (isTechnical) {
            messageDiv.classList.add('technical-message'); // Add technical class
        }
    }
    // Use innerText or textContent for safety, but pre for formatting technical messages
    if (isTechnical) {
        const preElement = document.createElement('pre');
        preElement.textContent = message; // Set text content for pre
        messageDiv.appendChild(preElement);

        // Add copy button specifically for commands
        if (message.includes("Command:\n")) {
            const copyButton = document.createElement('button');
            copyButton.textContent = 'Copy';
            copyButton.classList.add('copy-button'); // Add class for styling
            copyButton.onclick = () => {
                // Extract command part (assuming it's after "Command:\n")
                const commandText = message.substring(message.indexOf("Command:\n") + 9).trim();
                navigator.clipboard.writeText(commandText)
                    .then(() => {
                        copyButton.textContent = 'Copied!';
                        setTimeout(() => { copyButton.textContent = 'Copy'; }, 1500); // Reset after 1.5s
                    })
                    .catch(err => {
                        console.error('Failed to copy command: ', err);
                        // Optionally show an error message to the user
                    });
            };
            messageDiv.appendChild(copyButton); // Add button next to the pre
        }
    } else {
         messageDiv.textContent = message;
    }
    chatbox.appendChild(messageDiv);
    chatbox.scrollTop = chatbox.scrollHeight; // Scroll to bottom
}

async function sendMessage() {
    const messageText = userInput.value.trim();
    if (!messageText) return;

    addMessage(messageText, 'user');
    userInput.value = '';
    chatError.textContent = ''; // Clear previous errors

    try {
        // Add a thinking indicator (optional)
        addMessage("Thinking...", 'bot');
        const thinkingMessage = chatbox.lastChild; // Keep track of the thinking message

        const response = await fetch('/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: messageText,
                jmeter_path: jmeterPath, // Send config with each message
                openai_key: openaiKey
            }),
        });

        // Remove thinking indicator
        chatbox.removeChild(thinkingMessage);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Unknown server error' }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Display the user-facing response from the backend
        if (data.user_response) {
            addMessage(data.user_response, 'bot');
        }

        // Display the technical action if it exists, mark as technical
        if (data.technical_action && data.technical_action.command) {
            const technicalMessage = `Technical Action:\nType: ${data.technical_action.type}\nCommand:\n${data.technical_action.command}`;
            addMessage(technicalMessage, 'bot', true); // Mark as technical
        } else if (data.technical_action) {
            // Handle cases where technical_action might exist but be null or different
             const technicalMessage = `Technical Action: ${JSON.stringify(data.technical_action, null, 2)}`; // Pretty print JSON
            addMessage(technicalMessage, 'bot', true); // Mark as technical
        }

    } catch (error) {
        console.error('Error sending message:', error);
        chatError.textContent = `Error: ${error.message}`;
        // Optionally remove the thinking message on error too
        if (chatbox.lastChild && chatbox.lastChild.textContent === "Thinking...") {
             chatbox.removeChild(chatbox.lastChild);
        }
    }
}

// --- Function to check JMeter status ---
async function checkJMeterStatus() {
    // statusArea.textContent = 'Checking status...'; // Removed this line to reduce flicker
    chatError.textContent = ''; // Clear previous chat errors

    try {
        const response = await fetch('/get_last_jmeter_result');
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ detail: 'Unknown server error' }));
            throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // --- Display Logic (Corrected Structure) ---
        // Add/Remove running class for visual indicator
        if (result.status === "running") {
            statusArea.classList.add('running');
        } else {
            statusArea.classList.remove('running');
        }

        statusArea.innerHTML = `<strong>Last Run Status:</strong> ${result.status}<br>`; // Always show status

        if (result.status === "error_analyzed" || result.status === "error_analysis_failed") {
            // Display AI analysis results
            if (result.user_response) {
                statusArea.innerHTML += `<strong>AI Analysis:</strong><br><pre>${result.user_response}</pre>`;
            }
            if (result.technical_action) {
                statusArea.innerHTML += `<strong>Suggested Action:</strong><br><pre>${JSON.stringify(result.technical_action, null, 2)}</pre>`;
            } else {
                 statusArea.innerHTML += `<strong>Suggested Action:</strong> N/A<br>`;
            }

            // Add analysis to chat history only if it's a new error message, mark as technical
            const currentErrorMsg = result.original_error_message || result.user_response; // Use original error or fallback to analysis
            if (currentErrorMsg && currentErrorMsg !== lastShownAnalyzedError) {
                if (result.user_response) {
                    addMessage(`AI Analysis:\n${result.user_response}`, 'bot', true); // Mark as technical
                }
                if (result.technical_action) {
                    addMessage(`Suggested Action:\n${JSON.stringify(result.technical_action, null, 2)}`, 'bot', true); // Mark as technical
                }
                lastShownAnalyzedError = currentErrorMsg; // Update tracker
            }

        } else if (result.status === "success" || result.status === "running" || result.status === "error") {
             // Display original format for success, running, or non-analyzed error
             // Reset the error tracker if status is no longer analyzed error
             lastShownAnalyzedError = null;
             if (result.report_path) {
                 statusArea.innerHTML += `<strong>Report Path:</strong> ${result.report_path}<br>`;
             }
             // Display the output message (stdout/stderr) in a preformatted block
             if (result.message || result.output) { // Check both keys for robustness
                 statusArea.innerHTML += `<strong>Output:</strong><pre>${result.message || result.output}</pre>`;
             } else {
                 statusArea.innerHTML += `<strong>Output:</strong> N/A`;
             }
        } else if (result.status === "gui_launched" || result.status === "gui_launch_failed") {
            // Display GUI launch status message
            if (result.message) {
                 statusArea.innerHTML += `<strong>Message:</strong> ${result.message}<br>`;
            }
             // Reset error tracker if status is gui related
             lastShownAnalyzedError = null;
        } else {
             // Handle other potential statuses or initial state ("none")
             if (result.message) {
                  statusArea.innerHTML += `<strong>Message:</strong> ${result.message}<br>`;
             }
             // Reset error tracker if status is none or unknown
             lastShownAnalyzedError = null;
        }

        // Optionally, add it to the chatbox as well (consider formatting)
        // addMessage(`Status: ${result.status}, Output: ${result.message || result.output}`, 'bot');

    } catch (error) {
        console.error('Error checking JMeter status:', error);
        statusArea.textContent = `Error checking status: ${error.message}`;
        // Also show error in chat error area for visibility
        chatError.textContent = `Error checking status: ${error.message}`;
    }
}

// --- Toggle Status Panel ---
let isStatusVisible = true; // Assume visible initially
function toggleStatusPanel() {
    isStatusVisible = !isStatusVisible;
    if (isStatusVisible) {
        statusArea.style.maxHeight = '200px'; // Or original max-height
        statusArea.style.padding = '5px'; // Restore padding
        statusArea.style.borderWidth = '1px'; // Restore border
        toggleStatusButton.textContent = 'Hide Status';
        // Resume polling if it was stopped
        if (!statusIntervalId) {
             statusIntervalId = setInterval(checkJMeterStatus, 5000);
        }
    } else {
        statusArea.style.maxHeight = '0';
        // statusArea.style.padding = '0 5px'; // Let CSS handle padding via transition if needed
        // statusArea.style.borderWidth = '0'; // Let CSS handle border via transition if needed
        toggleStatusButton.textContent = 'Show Status';
        // Optionally stop polling when hidden
        // if (statusIntervalId) {
        //     clearInterval(statusIntervalId);
        //     statusIntervalId = null;
        // }
    }
}


// --- Event Listeners ---

saveConfigButton.addEventListener('click', saveConfig);

sendButton.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') {
        sendMessage();
    }
});

settingsButton.addEventListener('click', showConfigScreen); // Add listener for settings button
clearChatButton.addEventListener('click', () => {
    // Clear chatbox content, but leave the initial welcome message? Or clear all? Let's clear all for now.
    chatbox.innerHTML = '';
    // Optionally add back the welcome message:
    // addMessage("Welcome! How can I help you with JMeter today?", 'bot');
}); // Add listener for clear chat button
toggleStatusButton.addEventListener('click', toggleStatusPanel); // Add listener for toggle button
// Removed event listener for checkStatusButton


// --- Initial Load ---

if (jmeterPath && openaiKey) {
    showChatScreen();
} else {
    showConfigScreen();
}
