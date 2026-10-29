const form = document.getElementById('loginForm');
const passwordInput = document.getElementById('password');
const message = document.getElementById('loginMessage');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  const next = new URLSearchParams(window.location.search).get('next');
  const destination = next === '/mc' ? '/mc' : '/ctrl';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value })
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error || '登入失敗。';
      passwordInput.select();
      return;
    }
    window.location.replace(destination);
  } catch (error) {
    message.textContent = '無法連線至伺服器，請稍後再試。';
  }
});
