// Copyright (c) 2025 Davide Chen
// SPDX-License-Identifier: MIT

import * as BpmnAutoLayout from 'bpmn-auto-layout';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import lintModule   from 'bpmn-js-bpmnlint';
import lintConfig   from '../.bpmnlintrc';   // grazie al plug-in Rollup
import { marked } from 'marked';

/* ───────────  MODELER + LINTER ─────────── */
const modeler = new BpmnModeler({
  container: '#canvas',

  additionalModules: [ lintModule ],
  linting: { bpmnlint: lintConfig }
});

// active linting panel right away
modeler.get('linting').toggle();

const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-message');
const sidebar = document.getElementById('sidebar');
const fullscreenLabel = document.getElementById('fullscreen-label');
const fileDrop = document.getElementById('file-drop-area');
const fileInput = document.getElementById('file-input');

// For Expand || Collapse button
let isFullscreen = false;
function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  sidebar.style.marginLeft = isFullscreen ? '-35%' : '0';
  fullscreenLabel.textContent = isFullscreen ? 'Collapse' : 'Expand';
}


/* ──── LOAD DEFAULT BPMN DIAGRAM FROM EXTERNAL FILE ───── */

const defaultDiagramURL = '../diagram/default.bpmn';

fetch(defaultDiagramURL)
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to load BPMN file');
    }
    return response.text();
  })
  .then(xml => modeler.importXML(xml))
  .then(() => {
    console.log('✅ BPMN diagram loaded successfully');
  })
  .catch(error => {
    console.error('❌ Error loading BPMN diagram:', error);
  });

// Auto resize chat input field
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}


/* ────  CHAT HISTORY LAYOUT  ───── */

function sendMSG() {
  const text = chatInput.value.trim();
  if (!text) return;

  // 1. Show user message
  const userMessage = document.createElement('div');
  userMessage.className = 'chat-msg user';
  userMessage.innerHTML = `<div class="msg-header">User</div><div class="msg-content">${text}</div>`;  chatLog.appendChild(userMessage);
  chatLog.scrollTop = chatLog.scrollHeight;

  // 2. Reset textarea
  chatInput.value = '';
  chatInput.style.height = 'auto';

  // 3. Send the prompt
  sendPrompt(text);
}
    
chatInput.addEventListener('input', () => autoResize(chatInput));
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMSG();
  }
});

/* ─────────── SENDING PROMPT TO SERVER ─────────── */

async function callModelAPI(prompt, onDataChunk) {
  const model = document.getElementById('global-model-select').value;
  const reasoner = document.getElementById('model-status').innerText.trim().toLowerCase() === 'on';
 // true or false

  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, reasoner})
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let pendingBuffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    pendingBuffer += decoder.decode(value, { stream: true });
    let lines = pendingBuffer.split('\n');
    pendingBuffer = lines.pop(); // salva l’ultima riga incompleta per dopo

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith('data:')) continue;

      const jsonStr = line.substring(5).trim();
      if (jsonStr.trim().startsWith('[DONE')) break;

      try {
        const parsed = JSON.parse(jsonStr);
        const delta = parsed?.choices?.[0]?.delta;

        // Read the chunk from one of the two models
        const chunk =
          typeof delta?.reasoning_content === 'string'
            ? delta.reasoning_content
            : typeof delta?.content === 'string'
            ? delta.content
            : '';

        if (chunk !== '') {
          onDataChunk(chunk); 
        }
      } catch (e) {
        console.warn('JSON incomplete or broken chunk, retrying...', e);
        pendingBuffer = 'data: ' + jsonStr + '\n' + pendingBuffer;
        break;
      }
    }
  }
} 

/* ─────────── MESSAGE HANDLING ─────────── */

// Creates and shows the "typing…" indicator. 
function showTypingIndicator() {
  const indicator = document.createElement('div');
  indicator.className = 'chat-msg bot';
  indicator.innerHTML =
    '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  chatLog.appendChild(indicator);
  chatLog.scrollTop = chatLog.scrollHeight;
  return indicator;
}

// Creates the bot message wrapper (before adding content).
function createBotMessage() {
  const el = document.createElement('div');
  el.className = 'chat-msg bot';
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  return el;
}

/* ─────────── STREAM HANDLING ─────────── */

// Maintains shared state during chunked response
function initStreamContext() {
  return {
    botMessage: null,
    streamEl: null,
    fullRaw: ''
  };
}

// Initial rendering and progressive chunk appending
function handleStreamChunk(chunk, ctx) {
  // 1st chunk: removes the indicator and prepares the containers
  if (!ctx.botMessage) {
    chatLog.removeChild(ctx.typingIndicator);
    ctx.botMessage = createBotMessage();
    ctx.streamEl = document.createElement('div');
    ctx.streamEl.id = 'reasoning-stream';
    ctx.streamEl.style.whiteSpace = 'pre-wrap';

    if (modelStatus.textContent === 'On') {
      const header = document.createElement('div');
      header.className = 'msg-header';
      header.innerText = 'System';

      const reasoningBlock = document.createElement('div');
      reasoningBlock.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      ctx.streamEl.className = 'reasoning-text';
      reasoningBlock.appendChild(title);
      reasoningBlock.appendChild(ctx.streamEl);

      ctx.botMessage.appendChild(header);
      ctx.botMessage.appendChild(reasoningBlock);
    } else {
      const header = document.createElement('div');
      header.className = 'msg-header';
      header.innerText = 'System';
      ctx.botMessage.appendChild(header);
      ctx.botMessage.appendChild(ctx.streamEl);
    }
  }

  ctx.fullRaw += chunk;
  ctx.streamEl.textContent += chunk;
  chatLog.scrollTop = chatLog.scrollHeight;
}

/* ─────────── FINAL RENDERING ─────────── */

// Splits reasoning and XML output (if present)
function splitReasoningOutput(raw) {
  const xmlStart = raw.search(/<\?xml|<bpmn:definitions/i);
  return xmlStart !== -1
    ? { reasoning: raw.slice(0, xmlStart).trim(), output: raw.slice(xmlStart).trim() }
    : { reasoning: raw.trim(), output: '' };
}

// Converts the XML part into a highlighted Markdown block
function formatXml(xml) {
  return marked.parse('```xml\n' + xml + '\n```');
}

// Rendering the final message output
function finalizeBotMessage(ctx, startTime) {
  const { botMessage, fullRaw } = ctx;

  if (!botMessage) return;

  botMessage.innerHTML = ''; 

  if (modelStatus.textContent === 'On') {
    const { reasoning, output } = splitReasoningOutput(fullRaw);

    if (reasoning) {
      const block = document.createElement('div');
      block.className = 'reasoning-block';

      const title = document.createElement('strong');
      title.textContent = '🤔 Reasoning...';

      const text = document.createElement('div');
      text.className = 'reasoning-text';
      text.textContent = reasoning;

      block.appendChild(title);
      block.appendChild(text);
      botMessage.appendChild(block);
    }

    if (output) {
      const outBlock = document.createElement('div');
      outBlock.className = 'output-block';
      outBlock.innerHTML = formatXml(output);
      botMessage.appendChild(outBlock);
      hljs.highlightAll();
    }
  } else {
    const header = document.createElement('div');
    header.className = 'msg-header';
    header.innerText = 'System';

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = marked.parse(fullRaw);

    botMessage.appendChild(header);
    botMessage.appendChild(content);
    hljs.highlightAll();
  }

  botMessage.appendChild(buildReplyInfo(startTime));
}

// Compute the response time and displays it
function buildReplyInfo(startTime) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes ? `${minutes} min ${seconds} sec` : `${seconds} seconds`;

  const info = document.createElement('div');
  info.className = 'reply-time';
  info.textContent = `Replied in ${timeStr}`;
  return info;
}

/* ─────────── BPMN XML PROCESSING ─────────── */

// Imports BPMN if present and shows the outcome to the user
async function tryImportBpmn(xml) {
  if (!xml) {
    addMsg('No valid BPMN XML found ❌. Please try again.', 'bot');
    return;
  }

  try {
    await modeler.importXML(xml);
    addMsg('Diagram generated successfully ✅', 'bot');
  } catch (err) {
    console.error('❌ Errore durante importXML:', err);
    addMsg('Generated BPMN contains errors ⚠️. Please try again.', 'bot');
  }
}

/* ─────────── MAIN PIPELINE FUNCTION ─────────── */

async function sendPrompt(customText = null) {
  const isCustom = customText !== null;
  const txt = isCustom ? customText.trim() : chatInput.value.trim();
  if (!txt) return;

  const startTime = Date.now();

  // reset input field
  if (!isCustom) {
    chatInput.value = '';
    autoResize(chatInput);
  }

  // Shared state of the streaming
  const ctx = initStreamContext();
  ctx.typingIndicator = showTypingIndicator();

  try {
    await callModelAPI(txt, chunk => handleStreamChunk(chunk, ctx));

    // final parsing finale and rendering
    finalizeBotMessage(ctx, startTime);

    const xmlResponse = extractXmlFromResponse(ctx.fullRaw);
    await tryImportBpmn(xmlResponse);
  } catch (error) {
    console.error('API Error:', error);
    chatLog.removeChild(ctx.typingIndicator);
    addMsg(`Error: ${error.message}`, 'bot');
  }
}


function extractXmlFromResponse(content) {
  const match = content.match(/<bpmn:definitions[\s\S]*?<\/bpmn:definitions>/);
  return match ? match[0] : null;
}

function addBotMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg bot';

  // SYSTEM HEADER
  const header = document.createElement('div');
  header.className = 'msg-header';
  header.innerText = 'System';
  msg.appendChild(header);

  // CONTENT (markdown)
  const content = document.createElement('div');
  content.className = 'msg-content';
  content.innerHTML = marked.parse(text);
  msg.appendChild(content);

  chatLog.appendChild(msg);
  chatLog.scrollTop = chatLog.scrollHeight;

  hljs.highlightAll();
}


/* ─────────── EXPORTING BUTTONS HANDLERS ─────────── */

const exportSVGBtn = document.getElementById('exportSVG');
exportSVGBtn.addEventListener('click', exportSVG);

const exportXMLBtn = document.getElementById('exportXML');
exportXMLBtn.addEventListener('click', exportXML);

function exportXML() {
  modeler.saveXML({ format: true }).then(({ xml }) => download('diagram.bpmn', xml));
}
function exportSVG() {
  modeler.saveSVG().then(({ svg }) => download('diagram.svg', svg));
}
function fitView() {
  modeler.get('canvas').zoom('fit-viewport');
}

function download(filename, data) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}


/* ─────────── ZOOMING BUTTONS HANDLERS ─────────── */

const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomResetBtn = document.getElementById('zoom-reset');

zoomInBtn.addEventListener('click', () => {
  changeZoom(1.2); // Zoom in by +20%
});

zoomOutBtn.addEventListener('click', () => {
  changeZoom(0.8); // Zoom out by -20%
});

zoomResetBtn.addEventListener('click', () => {
  modeler.get('canvas').zoom('fit-viewport');
});

function changeZoom(factor) {
  const canvas = modeler.get('canvas');
  const currentZoom = canvas.zoom();
  const newZoom = currentZoom * factor;

  // limit min/max zoom
  if (newZoom < 0.2 || newZoom > 4) return;

  canvas.zoom(newZoom);
}


/* ─────────── AUTO LAYOUT HANDLER ─────────── */

const autoLayoutBtn = document.getElementById('autoLayout');
autoLayoutBtn.addEventListener('click', autoLayout);

async function autoLayout() {
  try {
    if (typeof BpmnAutoLayout === 'undefined') {
      throw new Error('BpmnAutoLayout not loaded');
    }

    const { xml } = await modeler.saveXML({ format: true });

    const result = await BpmnAutoLayout.layoutProcess(xml);

    if (!result) {
      throw new Error('layoutProcess did not return any result');
    }

    // Check if the result il a XML string
    let layoutedXml;
    if (typeof result === 'string') {
      layoutedXml = result;
    } else if (result.xml) {
      layoutedXml = result.xml;
    } else {
      throw new Error('layoutProcess result is not XML');
    }

    await modeler.importXML(layoutedXml);

    addBotMessage('✅ Auto-layout applied to current diagram');
  } catch (error) {
    console.error('Auto-layout error:', error);
    addBotMessage('❌ Failed to auto-layout diagram: ' + error.message);
  }
}

// Fullscreen toggle button
const fullscreenBtn = document.getElementById('toggleFullscreen');
fullscreenBtn.addEventListener('click', toggleFullscreen);


// Send button click
const sendBtn = document.getElementById('send-btn');
sendBtn.addEventListener('click', sendMSG);

// reasoner toggle
const modelToggle = document.getElementById('model-toggle');
let modelStatus = document.getElementById('model-status');


modelToggle.addEventListener('click', () => {
  const isReasonerOn = modelStatus.textContent.trim().toLowerCase() === 'on';

  const newStatus = isReasonerOn ? 'Off' : 'On';
  modelStatus.textContent = newStatus;
  modelToggle.classList.toggle('active', newStatus === 'On');
});


// Template popup
const templateLink = document.getElementById('template-link');
const templatePopup = document.getElementById('template-popup');

templateLink.addEventListener('click', e => {
  e.preventDefault();
  templatePopup.classList.toggle('visible');
});
document.addEventListener('click', e => {
  if (!templatePopup.contains(e.target) && !templateLink.contains(e.target)) {
    templatePopup.classList.remove('visible');
  }
});

/* ─────────── DRAG & DROP HANDLERS ─────────── */

// Prevent default behavior on the window
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  window.addEventListener(eventName, e => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });
});

// Custom drag&drop behavior
['dragenter', 'dragover'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.add('dragover');
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}));

['dragleave', 'dragend'].forEach(ev => fileDrop.addEventListener(ev, e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
}));

fileDrop.addEventListener('click', () => fileInput.click());

fileDrop.addEventListener('drop', e => {
  e.preventDefault();
  fileDrop.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', e => {
  handleFiles(e.target.files);
});


/* ─────────── FILE INPUT HANDLER ─────────── */

function handleFiles(list) {
      [...list].forEach(file => {
        const reader = new FileReader();

          if (file.type.startsWith('text/')) {
            // Text files (.txt)
            reader.onload = function(e) {
              const textContent = e.target.result;
              const safeContent = textContent.replace(/\n/g, '<br>');
              addMsg(`📎 <b>${file.name} (${Math.round(file.size/1024)} KB) added.</b> <br><br> 📄 <b>The file contains the following text:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${textContent}</em></div>`, 'user');
              sendPrompt(textContent);
            };
            reader.readAsText(file);
          } else if (file.type.startsWith('image/')) {
          // Images(.jpg, .png, ecc.)
            reader.onload = function(e) {
            const imgSrc = e.target.result;

            // Create a container element with a temporary loading message
            const messageContainer = document.createElement('div');
            messageContainer.className = 'chat-msg user';
            messageContainer.innerHTML = `
              <strong>🖼️ ${file.name} (${Math.round(file.size / 1024)} KB) added.</strong><br>
              <img src="${imgSrc}" style="max-width:50%;border-radius:8px;margin-top:8px;"><br><br>
              <em>📄 OCR Processing:</em><br>
              <div class="typing-indicator"><span></span><span></span><span></span></div>
            `;
            chatLog.appendChild(messageContainer);
            chatLog.scrollTop = chatLog.scrollHeight;

            // Start OCR
            Tesseract.recognize(
              imgSrc,
              'eng+ita',
              { logger: m => console.log(m) }
            ).then(({ data: { text } }) => {
              const recognizedText = text.trim();
              const formattedText = recognizedText ? recognizedText : 'No text detected.';

              // Replace the loading indicator with the actual OCR result
              messageContainer.innerHTML = `
                <strong>🖼️ ${file.name} (${Math.round(file.size / 1024)} KB) added.</strong><br>
                <img src="${imgSrc}" style="max-width:50%;border-radius:8px;margin-top:8px;"><br><br>
                <b>📄 OCR Recognized text:</b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;">
                <em>${formattedText}</em></div>`;

              if (recognizedText) {
                sendPrompt(recognizedText);
              }
            }).catch(error => {
              console.error('OCR error:', error);
              messageContainer.innerHTML += `<br><span style="color:red;">❌ Failed to read text from image.</span>`;
            });
          };
            reader.readAsDataURL(file);
          } else if (file.type === 'application/pdf') {
            const reader = new FileReader();
            reader.onload = async function(e) {
              const typedarray = new Uint8Array(e.target.result);

              const pdf = await pdfjsLib.getDocument(typedarray).promise;
              let fullText = '';

              for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const content = await page.getTextContent();
                const strings = content.items.map(item => item.str);
                fullText += strings.join(' ') + '\n\n';
              }

              console.log('Extracted text from PDF:', fullText);

              addMsg(`<strong><i class="fa-solid fa-file-pdf"></i> ${file.name} (${Math.round(file.size/1024)} KB) added.</strong><br><br><b><em>Extracted PDF text:</em></b><br><div style="background:#f8f9fa;border:1px solid #ddd;border-radius:8px;padding:10px;font-family:monospace;font-size:0.9rem;"><em>${fullText.replace(/\n/g, '<br>')}</em></div>`, 'user');

              if (fullText.trim()) {
                sendPrompt(fullText);
              } else {
                addMsg('❌ No text found in the PDF.', 'bot');
              }
            };
            reader.readAsArrayBuffer(file);
          } else {
          // Other kind of files
          addMsg(`📎 ${file.name} (${Math.round(file.size/1024)} KB) added (unsupported file type).`, 'user');
        }
      });
    }

function addMsg(m, w) {
      const d = document.createElement('div');
      d.className = 'chat-msg ' + w;

      // support Markdown e safe parsing 
      d.innerHTML = `<div class="msg-header">${w === 'user' ? 'User' : 'System'}</div><div class="msg-content">${marked.parse(m)}</div>`;  
      hljs.highlightAll();

      chatLog.appendChild(d);
      chatLog.scrollTop = chatLog.scrollHeight;
    }