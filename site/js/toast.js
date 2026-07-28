// Shared toast notification. Expects a <div id="toast"></div> somewhere on the page.

let hideTimeout;

export function showToast(message, type = 'success') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }

  const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  el.classList.add('show');

  clearTimeout(hideTimeout);
  hideTimeout = setTimeout(() => el.classList.remove('show'), 3200);
}
