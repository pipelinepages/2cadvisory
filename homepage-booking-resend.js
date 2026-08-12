/*
  2C Legal Advisory — homepage booking form Resend integration

  1) Replace EMAIL_ENDPOINT with the deployed Cloudflare Worker URL.
  2) Load this file near the end of the homepage, before </body>:
     <script src="homepage-booking-resend.js"></script>

  This script does not replace or restyle the existing homepage booking form.
  It hooks into the current "Book a Strategy Call" form and sends two
  confirmations through the shared Resend Worker: one to the prospect and
  one to 2c.legaladvisory@gmail.com.
*/
(() => {
  'use strict';

  if (window.__2C_BOOKING_RESEND_LOADED__) return;
  window.__2C_BOOKING_RESEND_LOADED__ = true;

  const EMAIL_ENDPOINT = 'https://2c-legal-report-email.b2bautomagic.workers.dev/';
  const boundForms = new WeakSet();
  const boundStandaloneButtons = new WeakSet();

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function newSubmissionId() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function byPlaceholder(root, placeholder) {
    return root.querySelector(`[placeholder="${CSS.escape(placeholder)}"]`);
  }

  function getFields(root) {
    const name =
      byPlaceholder(root, 'e.g. Adegoke Ogunlade') ||
      root.querySelector('input[name="name"], input[name="fullName"], input[autocomplete="name"]');

    const email =
      byPlaceholder(root, 'you@company.com') ||
      root.querySelector('input[type="email"], input[name="email"], input[autocomplete="email"]');

    const phone =
      byPlaceholder(root, '+234 800 000 0000') ||
      root.querySelector('input[type="tel"], input[name="phone"], input[autocomplete="tel"]');

    const preferredTime = root.querySelector('select');
    const discussion = root.querySelector('textarea');

    return { name, email, phone, preferredTime, discussion };
  }

  function findSubmitButton(root) {
    const buttons = [...root.querySelectorAll('button, input[type="submit"]')];
    return buttons.find(el => {
      const text = el.tagName === 'INPUT' ? el.value : el.textContent;
      return /send\s*request/i.test(text || '');
    }) || root.querySelector('button[type="submit"], input[type="submit"]');
  }

  function findBookingContainer(emailInput) {
    const form = emailInput.closest('form');
    if (form) return form;

    let node = emailInput.parentElement;
    for (let i = 0; node && i < 8; i++, node = node.parentElement) {
      if (findSubmitButton(node) && node.querySelector('textarea')) return node;
    }
    return emailInput.parentElement;
  }

  function getStatusEl(root, button) {
    let status = root.querySelector('[data-resend-booking-status]');
    if (status) return status;

    status = document.createElement('div');
    status.setAttribute('data-resend-booking-status', '');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'display:none;margin:12px 0 0;font-size:13px;line-height:1.5;';

    const footnote = [...root.querySelectorAll('p,small,div')].find(el =>
      /within 24 hours|no obligation, no jargon/i.test(el.textContent || '')
    );
    if (footnote && footnote !== root) footnote.parentNode.insertBefore(status, footnote);
    else if (button && button.parentNode) button.parentNode.insertBefore(status, button.nextSibling);
    else root.appendChild(status);

    return status;
  }

  function setStatus(status, kind, message) {
    if (!status) return;
    status.style.display = 'block';
    status.style.color = kind === 'error' ? '#fb7185' : kind === 'success' ? '#34d399' : 'inherit';
    status.textContent = message;
  }

  async function sendBooking(root) {
    if (root.dataset.resendBookingSending === '1') return;

    const fields = getFields(root);
    const button = findSubmitButton(root);
    const status = getStatusEl(root, button);

    const name = String(fields.name?.value || '').trim();
    const userEmail = String(fields.email?.value || '').trim();
    const phone = String(fields.phone?.value || '').trim();
    const preferredTime = String(fields.preferredTime?.value || '').trim();
    const discussion = String(fields.discussion?.value || '').trim();

    if (!name) {
      fields.name?.focus();
      fields.name?.reportValidity?.();
      setStatus(status, 'error', 'Please enter your full name.');
      return;
    }
    if (!validEmail(userEmail)) {
      fields.email?.focus();
      fields.email?.reportValidity?.();
      setStatus(status, 'error', 'Please enter a valid email address.');
      return;
    }

    if (!root.dataset.resendBookingId) root.dataset.resendBookingId = newSubmissionId();

    const originalButtonText = button
      ? (button.tagName === 'INPUT' ? button.value : button.textContent)
      : '';

    root.dataset.resendBookingSending = '1';
    if (button) {
      button.disabled = true;
      if (button.tagName === 'INPUT') button.value = 'Sending…';
      else button.textContent = 'Sending…';
    }
    setStatus(status, 'sending', 'Sending your request and confirmation emails…');

    try {
      const response = await fetch(EMAIL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'booking',
          submissionId: root.dataset.resendBookingId,
          userEmail,
          name,
          phone,
          preferredTime,
          discussion,
          source: 'Homepage',
        }),
      });

      let data = {};
      try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data.error || `Email service returned ${response.status}`);

      setStatus(status, 'success', `Request received. A confirmation was emailed to ${userEmail}, and 2C Legal Advisory received your booking details.`);
      if (button) {
        if (button.tagName === 'INPUT') button.value = 'Request Sent ✓';
        else button.textContent = 'Request Sent ✓';
      }
      root.dataset.resendBookingSent = '1';
    } catch (error) {
      setStatus(status, 'error', error?.message || 'We could not send your request. Please try again.');
      if (button) {
        button.disabled = false;
        if (button.tagName === 'INPUT') button.value = originalButtonText || 'Send Request →';
        else button.textContent = originalButtonText || 'Send Request →';
      }
    } finally {
      root.dataset.resendBookingSending = '0';
    }
  }

  function bindForm(form) {
    if (boundForms.has(form)) return;
    const fields = getFields(form);
    if (!fields.email || !fields.name || !fields.discussion) return;

    boundForms.add(form);
    form.addEventListener('input', () => {
      if (form.dataset.resendBookingSending !== '1' && form.dataset.resendBookingSent !== '1') {
        form.dataset.resendBookingId = '';
      }
    });

    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (form.reportValidity && !form.reportValidity()) return;
      sendBooking(form);
    }, true);
  }

  function bindStandalone(root) {
    const button = findSubmitButton(root);
    if (!button || boundStandaloneButtons.has(button)) return;
    const fields = getFields(root);
    if (!fields.email || !fields.name || !fields.discussion) return;

    boundStandaloneButtons.add(button);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      sendBooking(root);
    }, true);
  }

  function scan() {
    const emailCandidates = [...document.querySelectorAll('input[type="email"], input[placeholder="you@company.com"]')];
    for (const emailInput of emailCandidates) {
      const container = findBookingContainer(emailInput);
      if (!container) continue;
      const text = container.textContent || '';
      if (!/book a strategy call|send\s*request|hoping to discuss/i.test(text)) continue;
      const form = emailInput.closest('form');
      if (form) bindForm(form);
      else bindStandalone(container);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();

  // The homepage modal may be inserted/opened dynamically.
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
