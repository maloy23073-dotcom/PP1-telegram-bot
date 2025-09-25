import os
import logging
import random
import string
import time
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
    logger.warning("⚠️ JWT module not available - using simple tokens")

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище звонков
calls_storage = {}


def generate_room_token(room_name, user_id, is_moderator=False):
    """Генерация токена для комнаты"""
    if JWT_AVAILABLE:
        try:
            # JWT токен для организатора
            JITSI_APP_ID = os.environ.get("JITSI_APP_ID", "telegram-bot")
            JITSI_APP_SECRET = os.environ.get("JITSI_APP_SECRET", "default-secret-key")

            payload = {
                'context': {
                    'user': {
                        'id': user_id,
                        'name': f'User_{user_id}',
                        'moderator': is_moderator
                    }
                },
                'aud': 'jitsi',
                'iss': JITSI_APP_ID,
                'sub': JITSI_DOMAIN,
                'room': room_name,
                'exp': int(time.time()) + 24 * 3600,
                'nbf': int(time.time()) - 10
            }

            return jwt.encode(payload, JITSI_APP_SECRET, algorithm='HS256')
        except Exception as e:
            logger.error(f"JWT generation error: {e}")

    # Простой токен если JWT недоступен
    import hashlib
    token_data = f"{room_name}_{user_id}_{is_moderator}_{int(time.time())}"
    return hashlib.md5(token_data.encode()).hexdigest()[:16]


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

    # Генерируем токен для организатора
    room_token = generate_room_token(room_name, f"org_{message.from_user.id}", is_moderator=True)

    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'room_name': room_name,
        'room_token': room_token,
        'start_ts': int(datetime.now().timestamp()),
        'active': True,
        'participants': [],
        'is_organizer': True
    }

    # Ссылка для организатора
    org_jitsi_url = f"https://{JITSI_DOMAIN}/{room_name}"
    if JWT_AVAILABLE and room_token:
        org_jitsi_url += f"#jwt={room_token}"

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


@dp.message(Command("delete"))
async def cmd_delete(message: types.Message):
    args = message.text.split()
    if len(args) < 2:
        await message.answer("❌ **Использование:**\n`/delete <код_звонка>`\n\nПример: `/delete 123456`",
                             parse_mode="Markdown")
        return

    code = args[1]
    if code in calls_storage and calls_storage[code]['creator_id'] == message.from_user.id:
        del calls_storage[code]
        await message.answer(f"✅ **Звонок {code} удален**", parse_mode="Markdown")
    else:
        await message.answer("❌ **Звонок не найден или у вас нет прав для его удаления**", parse_mode="Markdown")


# FastAPI endpoints
@app.get("/")
async def read_root():
    return FileResponse("static/index.html")


@app.get("/call/{code}/info")
async def call_info(code: str, request: Request):
    """Информация о звонке"""
    logger.info(f"Call info requested for code: {code}")

    if code in calls_storage:
        call = calls_storage[code]

        # Простая проверка организатора по IP или другим параметрам
        client_ip = request.client.host
        is_organizer = call.get('is_organizer', False)

        response = {
            "exists": True,
            "room_name": call['room_name'],
            "is_organizer": is_organizer,
            "jwt_token": call['room_token'] if is_organizer and JWT_AVAILABLE else None,
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
        if user_id not in [p['user_id'] for p in call['participants']]:
            call['participants'].append({
                'user_id': user_id,
                'joined_at': datetime.now().isoformat(),
                'ip': client_ip
            })

        call['active'] = True

        response = {
            "success": True,
            "user_id": user_id,
            "participants_count": len(call['participants'])
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
    except Exception as e:
        logger.error(f"❌ Webhook setup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)