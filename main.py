import os
import logging
import random
import string
from datetime import datetime
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")
JITSI_DOMAIN = os.environ.get("JITSI_DOMAIN", "meet.jit.si")
JITSI_APP_ID = os.environ.get("JITSI_APP_ID", "")
JITSI_APP_SECRET = os.environ.get("JITSI_APP_SECRET", "")

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN environment variable is required!")
if not WEBAPP_URL:
    raise ValueError("WEBAPP_URL environment variable is required!")

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище звонков с JWT токенами
calls_storage = {}


def generate_jwt_token(room_name, user_id, is_moderator=False):
    """Генерация JWT токена для Jitsi (упрощенная)"""
    import time
    import jwt

    payload = {
        'context': {
            'user': {
                'id': user_id,
                'name': f'User_{user_id}',
                'avatar': '',
                'email': '',
                'moderator': is_moderator
            }
        },
        'aud': 'jitsi',
        'iss': JITSI_APP_ID,
        'sub': JITSI_DOMAIN,
        'room': room_name,
        'exp': int(time.time()) + 24 * 3600,  # 24 часа
        'nbf': int(time.time()) - 10  # 10 секунд назад
    }

    if JITSI_APP_ID and JITSI_APP_SECRET:
        return jwt.encode(payload, JITSI_APP_SECRET, algorithm='HS256')
    return None


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "🎥 **VideoCall Bot на Jitsi Meet**\n\n"
        "Качественные видеозвонки с мобильной оптимизацией!\n\n"
        "📋 **Команды:**\n"
        "/create - создать звонок\n"
        "/list - ваши звонки\n"
        "/delete - удалить звонок",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )


@dp.message(Command("create"))
async def cmd_create(message: types.Message):
    # Генерируем уникальный код и имя комнаты
    code = ''.join(random.choices(string.digits, k=6))
    room_name = f"tg_{code}_{message.from_user.id}"

    # Генерируем JWT токен для организатора
    jwt_token = generate_jwt_token(room_name, f"org_{message.from_user.id}", is_moderator=True)

    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'room_name': room_name,
        'jwt_token': jwt_token,
        'start_ts': int(datetime.now().timestamp()),
        'active': True,
        'participants': []
    }

    # Ссылка с токеном для организатора
    org_jitsi_url = f"https://{JITSI_DOMAIN}/{room_name}"
    if jwt_token:
        org_jitsi_url += f"#jwt={jwt_token}"

    await message.answer(
        f"✅ **Звонок создан!**\n\n"
        f"🔢 **Код:** `{code}`\n"
        f"👑 **Вы - организатор**\n"
        f"⏰ **Создан:** {datetime.now().strftime('%H:%M')}\n\n"
        f"📱 **Участники подключаются так:**\n"
        f"1. Нажимают кнопку ниже\n"
        f"2. Вводят код `{code}`\n"
        f"3. Нажимают 'Подключиться'",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=f"{WEBAPP_URL}?code={code}"))],
            [InlineKeyboardButton(text="🔗 Для организатора", url=org_jitsi_url)]
        ])
    )


@dp.message(Command("list"))
async def cmd_list(message: types.Message):
    user_calls = {code: data for code, data in calls_storage.items()
                  if data['creator_id'] == message.from_user.id}

    if not user_calls:
        await message.answer("📭 **У вас нет созданных звонков**", parse_mode="Markdown")
        return

    response = "📞 **Ваши звонки:**\n\n"
    for code, data in user_calls.items():
        start_time = datetime.fromtimestamp(data['start_ts']).strftime('%H:%M')
        participants = len(data['participants'])
        status = "✅ Активен" if data['active'] else "❌ Завершен"
        response += f"🔢 **Код:** `{code}`\n"
        response += f"⏰ **Время:** {start_time}\n"
        response += f"👥 **Участники:** {participants}\n"
        response += f"📊 **Статус:** {status}\n\n"

    await message.answer(response, parse_mode="Markdown")


@app.get("/call/{code}/info")
async def call_info(code: str, request: Request):
    """Информация о звонке с учетом организатора"""
    client_ip = request.client.host

    if code in calls_storage:
        call = calls_storage[code]

        # Проверяем, является ли пользователь организатором
        is_organizer = False
        try:
            # Пытаемся определить организатора по referrer или параметрам
            referer = request.headers.get('referer', '')
            if 'Telegram' in referer or 'tg' in referer.lower():
                # В реальном приложении здесь была бы проверка JWT или сессии
                is_organizer = True
        except:
            pass

        response = {
            "exists": True,
            "room_name": call['room_name'],
            "is_organizer": is_organizer,
            "jwt_token": call['jwt_token'] if is_organizer else None,
            "active": call['active'],
            "participants_count": len(call['participants'])
        }
        return response

    return {"exists": False}


@app.post("/call/{code}/join")
async def join_call(code: str, request: Request):
    """Регистрация участника с записью в историю"""
    client_ip = request.client.host

    if code in calls_storage:
        call = calls_storage[code]
        user_id = f"user_{client_ip}_{int(datetime.now().timestamp())}"

        # Добавляем участника в историю
        if user_id not in call['participants']:
            call['participants'].append({
                'user_id': user_id,
                'joined_at': datetime.now().isoformat(),
                'ip': client_ip
            })

        call['active'] = True

        return {
            "success": True,
            "user_id": user_id,
            "participants_count": len(call['participants'])
        }

    return {"success": False}

# Webhook endpoint для Telegram
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        update = types.Update(**data)
        await dp.feed_update(bot, update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.on_event("startup")
async def on_startup():
    webhook_url = f"{WEBAPP_URL}/webhook"
    try:
        await bot.set_webhook(webhook_url)
        logger.info(f"✅ Jitsi VideoCall Bot started successfully. Webhook: {webhook_url}")
        logger.info(f"✅ Jitsi Domain: {JITSI_DOMAIN}")
    except Exception as e:
        logger.error(f"❌ Webhook setup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)