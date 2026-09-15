'use strict';

const MODEL_CONFIG = {
  claude: {
    url: 'https://claude.ai/new',
    chat_url_template: (chatId) => `https://claude.ai/chat/${chatId}`,
    input_selector: "div[contenteditable='true']",
    fill: (el, text) => { el.innerHTML = text; },
    response_selector: '.standard-markdown',
    send_selector: "button[aria-label='Send message']",
    send_index: 0,
    done_selector_exists: "button[aria-label='Dictate'], button[aria-label='Use voice mode']",
    done_selector_not_exists: "button[aria-label='Stop response']",
    not_found_phrases: ['page not found', 'isn’t one of them', "isn't one of them"],
  },
  chatgpt: {
    url: 'https://chatgpt.com/',
    chat_url_template: (chatId) => `https://chatgpt.com/c/${chatId}`,
    input_selector: "div[contenteditable='true']",
    fill: (el, text) => { el.innerHTML = text; },
    response_selector: '.markdown',
    send_selector: "button[aria-label='Send prompt']",
    send_index: 0,
    done_selector_exists: "button[aria-label='Start Voice']",
    done_selector_not_exists: null,
    not_found_phrases: ['chat not found', 'conversation not found', 'page not found'],
  },
  gemini: {
    url: 'https://gemini.google.com/app',
    chat_url_template: (chatId) => `https://gemini.google.com/app/${chatId}`,
    input_selector: "div[contenteditable='true']",
    fill: (el, text) => { el.textContent = text; },
    response_selector: '.markdown',
    send_selector: "button[aria-label='Send message']",
    send_index: 0,
    done_selector_exists: "button[aria-label='Microphone']",
    done_selector_not_exists: null,
    not_found_phrases: ['something went wrong', 'page not found', 'conversation not found'],
  },
  deepseek: {
    url: 'https://chat.deepseek.com/',
    chat_url_template: (chatId) => `https://chat.deepseek.com/a/chat/s/${chatId}`,
    input_selector: 'textarea',
    fill: (el, text) => {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    response_selector: '.ds-markdown',
    send_selector: 'div > div[role=button].ds-button.ds-button--primary',
    send_index: 0,
    done_selector_exists: 'div > div[role=button].ds-button.ds-button--primary.ds-button--disabled',
    done_selector_not_exists: null,
    not_found_phrases: ['page not found', 'conversation not found'],
  },
};

function resolveTargetUrl(model, chatId) {
  const config = MODEL_CONFIG[model];
  if (chatId) return config.chat_url_template(chatId);
  return config.url;
}

module.exports = { MODEL_CONFIG, resolveTargetUrl };
