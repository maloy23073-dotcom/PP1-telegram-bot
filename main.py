import os
import logging
import random
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
JITSI_DOMAIN = os.environ.get("JITSI_DOMAIN", "meet.jit.si")  # Можно использовать свой сервер Jitsi

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN environment variable is required!")
if not WEBAPP_URL:
    raise ValueError("WEBAPP_URL environment variable is required!")

# Инициализация бота
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
app = FastAPI()

# Подключаем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище звонков
calls_storage = {}


# Обработчики команд бота
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "🎥 **VideoCall Bot на Jitsi Meet**\n\n"
        "Я помогу вам организовать качественные видеозвонки через Jitsi Meet!\n\n"
        "📋 **Доступные команды:**\n"
        "/create - создать новый звонок\n"
        "/list - список ваших звонков\n"
        "/delete - удалить звонок\n\n"
        "Нажмите кнопку ниже чтобы открыть видеозвонок:",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )


@dp.message(Command("create"))
async def cmd_create(message: types.Message):
    # Генерируем уникальный код комнаты
    code = ''.join([str(random.randint(0, 9)) for _ in range(10)])
    room_name = f"telegram_{code}"

    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'room_name': room_name,
        'start_ts': int(datetime.now().timestamp()),
        'active': True
    }

    jitsi_url = f"https://{JITSI_DOMAIN}/{room_name}"

    await message.answer(
        f"✅ **Звонок создан!**\n\n"
        f"🔢 **Код для подключения:** `{code}`\n"
        f"🌐 **Ссылка на звонок:** {jitsi_url}\n"
        f"⏰ **Длительность:** неограниченно\n\n"
        f"📱 **Чтобы присоединиться:**\n"
        f"1. Откройте Mini App по кнопке ниже\n"
        f"2. Введите код `{code}`\n"
        f"3. Нажмите 'Подключиться'\n\n"
        f"💡 **Или отправьте ссылку участникам:**\n{jitsi_url}",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=f"{WEBAPP_URL}?code={code}"))],
            [InlineKeyboardButton(text="🔗 Открыть в браузере", url=jitsi_url)]
        ])
    )


@dp.message(Command("list"))
async def cmd_list(message: types.Message):
    user_calls = {code: data for code, data in calls_storage.items()
                  if data['creator_id'] == message.from_user.id}

    if not user_calls:
        await message.answer("📭 **У вас нет созданных звонков**\n\nИспользуйте /create чтобы создать первый звонок",
                             parse_mode="Markdown")
        return

    response = "📞 **Ваши активные звонки:**\n\n"
    for code, data in user_calls.items():
        start_time = datetime.fromtimestamp(data['start_ts']).strftime('%d.%m.%Y %H:%M')
        jitsi_url = f"https://{JITSI_DOMAIN}/{data['room_name']}"
        status = "✅ Активен" if data['active'] else "❌ Завершен"
        response += f"🔢 **Код:** `{code}`\n"
        response += f"⏰ **Создан:** {start_time}\n"
        response += f"🔗 **Ссылка:** {jitsi_url}\n"
        response += f"📊 **Статус:** {status}\n\n"

    await message.answer(response, parse_mode="Markdown")


@dp.message(Command("delete"))
async def cmd_delete(message: types.Message):
    args = message.text.split()
    if len(args) < 2:
        await message.answer("❌ **Использование:**\n`/delete <код_звонка>`\n\nПример: `/delete 1234567890`",
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
async def call_info(code: str):
    """Информация о звонке для Jitsi"""
    if code in calls_storage:
        call = calls_storage[code]
        jitsi_url = f"https://{JITSI_DOMAIN}/{call['room_name']}"

        return {
            "exists": True,
            "room_name": call['room_name'],
            "jitsi_url": jitsi_url,
            "active": call['active']
        }
    return {"exists": False}


@app.post("/call/{code}/join")
async def join_call(code: str):
    """Регистрация участника звонка"""
    if code in calls_storage:
        calls_storage[code]['active'] = True
        return {"success": True}
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