import os
import logging
import random
import string
import time
from datetime import datetime
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.templating import Jinja2Templates

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

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
app = FastAPI(title="Telegram VideoCall Bot")

# Монтируем статические файлы
app.mount("/static", StaticFiles(directory="static"), name="static")

# Хранилище звонков
calls_storage = {}


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "🎥 **Telegram Call - Видеозвонки**\n\n"
        "Безопасные видеозвонки через Jitsi Meet\n\n"
        "📋 **Команды:**\n"
        "/create - создать звонок\n"
        "/list - список звонков\n"
        "/delete - удалить звонок\n\n"
        "Нажмите кнопку ниже чтобы открыть видеозвонок:",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )


@dp.message(Command("create"))
async def cmd_create(message: types.Message):
    code = ''.join(random.choices(string.digits, k=6))
    room_name = f"telegram_call_{code}"

    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'creator_name': message.from_user.first_name,
        'room_name': room_name,
        'start_ts': int(datetime.now().timestamp()),
        'active': True,
        'participants': [],
        'is_public': True
    }

    jitsi_url = f"https://{JITSI_DOMAIN}/{room_name}"

    await message.answer(
        f"✅ **Звонок создан!**\n\n"
        f"🔢 **Код для подключения:** `{code}`\n"
        f"👤 **Организатор:** {message.from_user.first_name}\n"
        f"⏰ **Создан:** {datetime.now().strftime('%H:%M')}\n\n"
        f"📱 **Участники подключаются через Mini App**",
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
        await message.answer("📭 **У вас нет созданных звонков**\n\nИспользуйте /create чтобы создать первый звонок",
                             parse_mode="Markdown")
        return

    response = "📞 **Ваши активные звонки:**\n\n"
    for code, data in user_calls.items():
        start_time = datetime.fromtimestamp(data['start_ts']).strftime('%H:%M')
        participants = len(data['participants'])
        response += f"🔢 **Код:** `{code}`\n"
        response += f"⏰ **Время:** {start_time}\n"
        response += f"👥 **Участники:** {participants}\n\n"

    await message.answer(response, parse_mode="Markdown")


@dp.message(Command("delete"))
async def cmd_delete(message: types.Message):
    args = message.text.split()

    if len(args) < 2:
        user_calls = {code: data for code, data in calls_storage.items()
                      if data['creator_id'] == message.from_user.id}

        if not user_calls:
            await message.answer("❌ **У вас нет звонков для удаления**", parse_mode="Markdown")
            return

        keyboard = []
        for code in user_calls.keys():
            keyboard.append([InlineKeyboardButton(text=f"❌ Удалить звонок {code}", callback_data=f"delete_{code}")])

        markup = InlineKeyboardMarkup(inline_keyboard=keyboard)

        await message.answer(
            "🗑 **Выберите звонок для удаления:**\n\n"
            "Или используйте команду: `/delete <код>`\n\n"
            "Пример: `/delete 123456`",
            reply_markup=markup,
            parse_mode="Markdown"
        )
        return

    code = args[1]

    if not code.isdigit() or len(code) != 6:
        await message.answer("❌ **Код должен состоять из 6 цифр**\n\nПример: `/delete 123456`", parse_mode="Markdown")
        return

    if code in calls_storage and calls_storage[code]['creator_id'] == message.from_user.id:
        room_name = calls_storage[code]['room_name']
        del calls_storage[code]
        await message.answer(f"✅ **Звонок {code} удален**\n\nКомната: `{room_name}`", parse_mode="Markdown")
    else:
        await message.answer("❌ **Звонок не найден или у вас нет прав для его удаления**", parse_mode="Markdown")


@dp.callback_query(lambda c: c.data.startswith('delete_'))
async def process_delete_callback(callback_query: types.CallbackQuery):
    code = callback_query.data.replace('delete_', '')

    if code in calls_storage and calls_storage[code]['creator_id'] == callback_query.from_user.id:
        room_name = calls_storage[code]['room_name']
        del calls_storage[code]
        await callback_query.message.edit_text(
            f"✅ **Звонок {code} удален**\n\nКомната: `{room_name}`",
            parse_mode="Markdown"
        )
    else:
        await callback_query.answer("❌ Звонок не найден", show_alert=True)


# Основной маршрут для Mini App
@app.get("/", response_class=HTMLResponse)
async def read_root():
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Index file not found")


# API endpoints
@app.get("/call/{code}/info")
async def call_info(code: str):
    print(f"Call info requested: {code}")

    if code in calls_storage:
        call = calls_storage[code]
        return {
            "exists": True,
            "room_name": call['room_name'],
            "active": call['active']
        }

    return {"exists": False, "active": False}


@app.post("/call/{code}/join")
async def join_call(code: str):
    print(f"Join call requested: {code}")

    if code in calls_storage:
        calls_storage[code]['active'] = True
        return {"success": True}

    return {"success": False}

# Webhook для Telegram
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


# Health check
@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.on_event("startup")
async def on_startup():
    webhook_url = f"{WEBAPP_URL}/webhook"
    try:
        await bot.set_webhook(webhook_url)
        logger.info(f"✅ Bot started successfully")
        logger.info(f"✅ Webhook: {webhook_url}")
        logger.info(f"✅ Mini App URL: {WEBAPP_URL}")
    except Exception as e:
        logger.error(f"❌ Webhook setup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)