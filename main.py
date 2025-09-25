import os
import logging
import random
import string
import time
import jwt
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

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN environment variable is required!")
if not WEBAPP_URL:
    raise ValueError("WEBAPP_URL environment variable is required!")

# Проверяем наличие JWT
try:
    import jwt

    JWT_AVAILABLE = True
    logger.info("✅ JWT module is available")
except ImportError:
    JWT_AVAILABLE = False
    logger.warning("⚠️ JWT module not available - using open rooms")

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище звонков
calls_storage = {}


def generate_jwt_token(room_name, user_id, user_name="Participant", is_moderator=False):
    """Генерация JWT токена для Jitsi Meet"""
    if not JWT_AVAILABLE:
        return None

    try:
        # Используем стандартные настройки для Jitsi
        JITSI_APP_ID = "telegram-bot"
        JITSI_APP_SECRET = "your-secret-key-change-in-production"

        payload = {
            'context': {
                'user': {
                    'id': user_id,
                    'name': user_name,
                    'avatar': '',
                    'email': '',
                    'moderator': is_moderator
                },
                'group': ''
            },
            'aud': 'jitsi',
            'iss': JITSI_APP_ID,
            'sub': JITSI_DOMAIN,
            'room': room_name,
            'exp': int(time.time()) + 24 * 3600,  # 24 часа
            'nbf': int(time.time()) - 10,
            'moderator': is_moderator
        }

        token = jwt.encode(payload, JITSI_APP_SECRET, algorithm='HS256')
        return token
    except Exception as e:
        logger.error(f"JWT token generation error: {e}")
        return None


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "🎥 **Telegram Call - Видеозвонки**\n\n"
        "Безопасные видеозвонки через Jitsi Meet\n\n"
        "📋 **Команды:**\n"
        "/create - создать открытый звонок\n"
        "/list - ваши звонки\n"
        "/delete - удалить звонок",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )


@dp.message(Command("create"))
async def cmd_create(message: types.Message):
    # Генерируем уникальный код и имя комнаты
    code = ''.join(random.choices(string.digits, k=6))
    room_name = f"telegram_call_{code}"

    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'creator_name': message.from_user.first_name,
        'room_name': room_name,
        'start_ts': int(datetime.now().timestamp()),
        'active': True,
        'participants': [],
        'is_public': True  # Делаем комнату публичной
    }

    jitsi_url = f"https://{JITSI_DOMAIN}/{room_name}"

    await message.answer(
        f"✅ **Звонок создан!**\n\n"
        f"🔢 **Код для подключения:** `{code}`\n"
        f"🌐 **Комната:** {room_name}\n"
        f"👤 **Организатор:** {message.from_user.first_name}\n"
        f"⏰ **Создан:** {datetime.now().strftime('%H:%M')}\n\n"
        f"📱 **Участники подключаются так:**\n"
        f"1. Нажимают кнопку 'Открыть VideoCall'\n"
        f"2. Вводят код `{code}`\n"
        f"3. Нажимают 'Присоединиться'",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=f"{WEBAPP_URL}?code={code}"))],
            [InlineKeyboardButton(text="🔗 Прямая ссылка", url=jitsi_url)]
        ])
    )


@dp.message(Command("list"))
async def cmd_list(message: types.Message):
    user_calls = {code: data for code, data in calls_storage.items()
                  if data['creator_id'] == message.from_user.id}

    if not user_calls:
        await message.answer("📭 **У вас нет созданных звонков**", parse_mode="Markdown")
        return

    response = "📞 **Ваши активные звонки:**\n\n"
    for code, data in user_calls.items():
        start_time = datetime.fromtimestamp(data['start_ts']).strftime('%H:%M')
        participants = len(data['participants'])
        response += f"🔢 **Код:** `{code}`\n"
        response += f"⏰ **Время:** {start_time}\n"
        response += f"👥 **Участники:** {participants}\n"
        response += f"🌐 **Статус:** {'🔓 Открытый' if data['is_public'] else '🔒 Закрытый'}\n\n"

    await message.answer(response, parse_mode="Markdown")


@app.get("/call/{code}/info")
async def call_info(code: str, request: Request):
    """Информация о звонке с генерацией токена для участника"""
    logger.info(f"Call info requested for code: {code}")

    if code in calls_storage:
        call = calls_storage[code]

        # Получаем информацию о пользователе
        user_agent = request.headers.get('user-agent', '')
        client_ip = request.client.host
        user_id = f"user_{client_ip}_{int(time.time())}"

        # Определяем тип пользователя (организатор или участник)
        is_organizer = False  # В реальном приложении здесь была бы проверка авторизации

        # Генерируем JWT токен для участника
        user_name = f"Участник_{random.randint(1000, 9999)}"
        jwt_token = generate_jwt_token(call['room_name'], user_id, user_name, is_moderator=is_organizer)

        response = {
            "exists": True,
            "room_name": call['room_name'],
            "jwt_token": jwt_token,
            "is_public": call.get('is_public', True),
            "active": call['active'],
            "participants_count": len(call['participants']),
            "jwt_available": JWT_AVAILABLE
        }
        logger.info(f"Call found: {response}")
        return response

    response = {"exists": False, "active": False}
    logger.info(f"Call not found: {response}")
    return response


@app.post("/call/{code}/join")
async def join_call(code: str, request: Request):
    """Регистрация участника звонка"""
    logger.info(f"Join call requested for code: {code}")

    if code in calls_storage:
        call = calls_storage[code]
        client_ip = request.client.host

        # Генерируем ID пользователя
        user_id = f"user_{client_ip}_{int(time.time())}"

        # Добавляем участника в историю
        call['participants'].append({
            'user_id': user_id,
            'joined_at': datetime.now().isoformat(),
            'ip': client_ip
        })

        call['active'] = True

        response = {
            "success": True,
            "user_id": user_id,
            "participants_count": len(call['participants']),
            "room_name": call['room_name']
        }
        logger.info(f"Join successful: {response}")
        return response

    response = {"success": False, "message": "Call not found"}
    logger.info(f"Join failed: {response}")
    return response


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
    return {"ok": True, "jwt_available": JWT_AVAILABLE}


@app.on_event("startup")
async def on_startup():
    webhook_url = f"{WEBAPP_URL}/webhook"
    try:
        await bot.set_webhook(webhook_url)
        logger.info(f"✅ Bot started successfully. Webhook: {webhook_url}")
        logger.info(f"✅ JWT available: {JWT_AVAILABLE}")
        logger.info(f"✅ Jitsi domain: {JITSI_DOMAIN}")
    except Exception as e:
        logger.error(f"❌ Webhook setup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)