import os
import random
import logging
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from aiohttp import ClientSession
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes, ConversationHandler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Инициализация FastAPI приложения
app = FastAPI()

# States for ConversationHandler
ASK_TIME, ASK_DURATION = range(2)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")
SIGNALING_SECRET = os.environ.get("SIGNALING_SECRET", "SecretKey123!")
TZ = ZoneInfo("Europe/Vilnius")
PORT = int(os.environ.get("PORT", 10000))

# In-memory storage
calls_storage = {}
rooms = {}
scheduler = AsyncIOScheduler()
http_session = None
bot_app = None

# Mount WebApp
WEBAPP_DIR = os.environ.get("WEBAPP_DIR", "webapp")
app.mount("/", StaticFiles(directory=WEBAPP_DIR, html=True), name="webapp")


# Basic functions
def gen_code():
    return "{:06d}".format(random.randint(0, 999999))


def save_call(code, creator_id, start_ts, duration_min):
    call_id = f"{code}_{datetime.now().timestamp()}"
    calls_storage[call_id] = {
        'code': code, 'creator_id': creator_id, 'start_ts': start_ts,
        'duration_min': duration_min, 'created_ts': int(datetime.now(tz=TZ).timestamp()), 'active': True
    }
    return call_id


def get_user_calls(user_id):
    return [(
        data['code'],
        datetime.fromtimestamp(data['start_ts'], tz=TZ).strftime('%Y-%m-%d %H:%M'),
        data['duration_min'],
        data['active']
    ) for data in calls_storage.values() if data['creator_id'] == user_id]


def get_call_by_code(code):
    for call_id, data in calls_storage.items():
        if data['code'] == code:
            return (call_id, data['code'], data['creator_id'], data['start_ts'], data['duration_min'], data['active'])
    return None


def mark_call_inactive(call_id):
    if call_id in calls_storage:
        calls_storage[call_id]['active'] = False
        return True
    return False


# Bot handlers
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [[InlineKeyboardButton("Открыть Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]]
    await update.message.reply_text(
        "Привет! Используй команды:\n/create - создать звонок\n/list - мои звонки\n/delete - удалить звонок",
        reply_markup=InlineKeyboardMarkup(kb)
    )


async def create_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Введите время начала (HH:MM):")
    return ASK_TIME


async def create_time_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    time_str = update.message.text.strip()
    try:
        dt = datetime.strptime(time_str, "%H:%M").replace(
            year=datetime.now().year,
            month=datetime.now().month,
            day=datetime.now().day,
            tzinfo=TZ
        )
        if dt < datetime.now(TZ):
            dt += timedelta(days=1)
        context.user_data["call_start_dt"] = dt
        await update.message.reply_text(f"Время: {dt.strftime('%H:%M')}. Введите длительность в минутах:")
        return ASK_DURATION
    except:
        await update.message.reply_text("Неверный формат. Используйте HH:MM")
        return ASK_TIME


async def create_duration_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        minutes = int(update.message.text.strip())
        dt = context.user_data["call_start_dt"]
        code = gen_code()
        call_id = save_call(code, update.message.from_user.id, int(dt.timestamp()), minutes)

        await update.message.reply_text(f"✅ Звонок создан! Код: {code}")
        return ConversationHandler.END
    except:
        await update.message.reply_text("Введите число минут")
        return ASK_DURATION


async def list_calls(update: Update, context: ContextTypes.DEFAULT_TYPE):
    calls = get_user_calls(update.message.from_user.id)
    if not calls:
        await update.message.reply_text("Нет созданных звонков")
        return

    response = "Ваши звонки:\n" + "\n".join(
        f"• {code} - {time} - {dur} мин" for code, time, dur, active in calls
    )
    await update.message.reply_text(response)


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Отменено")
    return ConversationHandler.END


# WebSocket handlers
async def broadcast(room_code, message, exclude=None):
    if room_code in rooms:
        for peer_id, ws in list(rooms[room_code]["participants"].items()):
            if peer_id != exclude:
                try:
                    await ws.send_json(message)
                except:
                    del rooms[room_code]["participants"][peer_id]


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    peer_id, room_code = None, None

    try:
        async for data in websocket.iter_json():
            typ = data.get("type")

            if typ == "join":
                room_code, peer_id = data.get("code"), data.get("peer_id")
                if room_code not in rooms:
                    rooms[room_code] = {"participants": {}, "lock": asyncio.Lock()}
                async with rooms[room_code]["lock"]:
                    rooms[room_code]["participants"][peer_id] = websocket
                await broadcast(room_code, {"type": "new_peer", "peer_id": peer_id}, peer_id)

            elif typ in ("offer", "answer", "ice"):
                target, room_code = data.get("target"), data.get("code")
                if room_code in rooms and target in rooms[room_code]["participants"]:
                    try:
                        await rooms[room_code]["participants"][target].send_json(data)
                    except:
                        del rooms[room_code]["participants"][target]

    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if room_code and peer_id and room_code in rooms:
            async with rooms[room_code]["lock"]:
                if peer_id in rooms[room_code]["participants"]:
                    del rooms[room_code]["participants"][peer_id]
            await broadcast(room_code, {"type": "peer_left", "peer_id": peer_id})


# API endpoints
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        if bot_app:
            update = Update.de_json(data, bot_app.bot)
            await bot_app.process_update(update)
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/ping")
async def ping():
    return {"ok": True}


# Startup/shutdown
@app.on_event("startup")
async def on_startup():
    global bot_app

    if not BOT_TOKEN or not WEBAPP_URL:
        logger.error("Missing required environment variables")
        return

    try:
        # ТОЛЬКО СОВРЕМЕННЫЙ СИНТАКСИС - никакого Updater!
        bot_app = Application.builder().token(BOT_TOKEN).build()

        # Add handlers
        conv_handler = ConversationHandler(
            entry_points=[CommandHandler("create", create_start)],
            states={
                ASK_TIME: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_time_received)],
                ASK_DURATION: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_duration_received)]
            },
            fallbacks=[CommandHandler("cancel", cancel)]
        )

        bot_app.add_handler(CommandHandler("start", start))
        bot_app.add_handler(conv_handler)
        bot_app.add_handler(CommandHandler("list", list_calls))

        # Set webhook
        await bot_app.bot.set_webhook(f"{WEBAPP_URL}/webhook")
        logger.info("✅ Bot started successfully")

    except Exception as e:
        logger.error(f"❌ Bot startup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    if bot_app:
        await bot_app.bot.delete_webhook()
        await bot_app.shutdown()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)