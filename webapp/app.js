// В начале файла добавьте проверку активности звонка
async function checkCallActive(code) {
  try {
    const response = await fetch(`/call/${code}/status`);
    const data = await response.json();
    return data.active;
  } catch (e) {
    console.error("Check call active error:", e);
    return false;
  }
}
async function joinCall(code) {
  try {
    const response = await fetch(`/call/${code}/join`, { method: 'POST' });
    const data = await response.json();
    return data.success;
  } catch (e) {
    console.error("Join call error:", e);
    return false;
  }
}

// Обновите функцию join()
async function join() {
  const code = codeInput.value.trim();
  if (!/^\d{6}$/.test(code)) {
    showStatus("Код должен быть 6 цифр", "error");
    return;
  }

  // Проверка активности звонка
  showStatus("Проверка активности звонка...");
  const isActive = await checkCallActive(code);
  if (!isActive) {
    showStatus("Звонок не найден или не активен", "error");
    return;
  }

  // Регистрация участника
  showStatus("Регистрация в звонке...");
  const joined = await joinCall(code);
  if (!joined) {
    showStatus("Ошибка регистрации в звонке", "error");
    return;
  }

  roomCode = code;
  currentCodeSpan.textContent = code;
  showStatus("Запрашиваю доступ к камере/микрофону...");

  try {
    await startLocalMedia();
  } catch (e) {
    showStatus("Ошибка доступа к медиа: " + e.message, "error");
    return;
  }

  showStatus("Подключение к сигналингу...");
  await connectSignaling(code);
  showPage(callPage);
}