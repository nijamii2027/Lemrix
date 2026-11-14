'use strict';

const $ = selector => document.querySelector(selector);
const memory = {};
function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return memory[key] ?? fallback; }
}
function write(key, value) {
  memory[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
let toastTimer;
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

const navigation = $('#mobile-menu');
const navigationToggle = $('#menu-button');
let stopMenuAnimation;
function setMenuOpen(open) {
  stopMenuAnimation?.();
  stopMenuAnimation = undefined;
  navigation.style.removeProperty('opacity');
  navigation.style.removeProperty('translate');
  navigation.hidden = !open;
  navigationToggle.setAttribute('aria-expanded', String(open));
  navigationToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  const motion = window.LemrixMotionState;
  if (!open || !motion) return;
  const distance = motion.systemReduced ? 4 : 16;
  navigation.style.opacity = '.65';
  navigation.style.translate = `0 -${distance}px`;
  let began;
  stopMenuAnimation = motion.onFrame(time => {
    began ??= time;
    const remaining = (1 - Math.min(1, (time - began) / 220)) ** 3;
    navigation.style.opacity = 1 - remaining * .35;
    navigation.style.translate = `0 ${-distance * remaining}px`;
    if (remaining === 0) {
      stopMenuAnimation();
      stopMenuAnimation = undefined;
      navigation.style.removeProperty('opacity');
      navigation.style.removeProperty('translate');
    }
  });
}
navigationToggle.addEventListener('click', () => setMenuOpen(navigation.hidden));
window.addEventListener('resize', () => {
  if (innerWidth > 960 && !navigation.hidden) setMenuOpen(false);
}, { passive: true });

function syncDialogState() {
  const open = Boolean($('dialog[open]'));
  document.body.style.overflow = open ? 'hidden' : '';
  window.dispatchEvent(new CustomEvent('lemrix:dialog', { detail: { open } }));
}
function openDialog(selector) {
  const dialog = $(selector);
  if (!dialog || dialog.open) return;
  for (const old of document.querySelectorAll('dialog[open]')) closeDialog(old);
  setMenuOpen(false);
  dialog.showModal();
  window.LemrixMotion?.enterDialog(dialog);
  syncDialogState();
}
function closeDialog(dialog, animated = false) {
  if (!dialog?.open) return;
  const finish = () => {
    dialog.close();
    dialog.removeAttribute('data-closing');
    syncDialogState();
  };
  if (animated && window.LemrixMotion) window.LemrixMotion.dismissDialog(dialog, finish);
  else finish();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.setAttribute('data-lenis-prevent', '');
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    closeDialog(dialog, true);
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
      closeDialog(dialog, true);
    }
  });
  dialog.addEventListener('close', syncDialogState);
}

document.addEventListener('click', event => {
  if (!navigation.hidden && !event.target.closest('#mobile-menu, #menu-button')) setMenuOpen(false);
  if (event.target.closest('[data-close]')) {
    closeDialog(event.target.closest('dialog'), true);
    return;
  }
  const opener = event.target.closest('[data-dialog]');
  if (opener) {
    openDialog(opener.dataset.dialog);
    if (opener.id === 'open-search' && !window.LemrixMotionState.touch) {
      $('#search-input').focus({ preventScroll: true });
    }
    return;
  }
  if (event.target.closest('#mobile-menu a')) setMenuOpen(false);
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const destination = event.target.closest('a[data-staircase]');
  if (destination) {
    if (destination.getAttribute('aria-current') === 'page') {
      event.preventDefault();
      return;
    }
    if (window.LemrixRoute?.depart(destination)) event.preventDefault();
    return;
  }
  const homeSection = event.target.closest('[data-home-scroll]');
  if (homeSection) {
    try { sessionStorage.setItem('lemrix.home-scroll', homeSection.hash); } catch {}
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !navigation.hidden) {
    setMenuOpen(false);
    navigationToggle.focus();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !$('dialog[open]')) {
    event.preventDefault();
    $('#open-search').click();
  }
});

const enquiry = $('#enquiry-form');
const enquiryStatus = $('#enquiry-status');
const sendEnquiry = $('#send-enquiry');
let pendingSubmission;
enquiry.addEventListener('input', () => {
  enquiryStatus.textContent = '';
});
enquiry.addEventListener('submit', async event => {
  event.preventDefault();
  if (sendEnquiry.disabled || !enquiry.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(enquiry));
  const signature = JSON.stringify(fields);
  if (pendingSubmission?.signature !== signature) {
    pendingSubmission = { signature, id: crypto.randomUUID() };
  }
  sendEnquiry.disabled = true;
  enquiryStatus.textContent = 'Sending…';
  try {
    const response = await fetch(enquiry.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, id: pendingSubmission.id })
    });
    const result = await response.json();
    if (!response.ok) {
      enquiryStatus.textContent = result.error || 'The message couldn’t be sent. Please try again.';
      return;
    }
    if (result.received !== true) throw new Error('Unexpected response');
    enquiry.reset();
    pendingSubmission = undefined;
    enquiryStatus.textContent = 'Message sent. Lemrix can reply to the email you provided.';
  } catch {
    enquiryStatus.textContent = 'Couldn’t confirm delivery. Please try again.';
  } finally {
    sendEnquiry.disabled = false;
  }
});

$('#year').textContent = new Date().getFullYear();
