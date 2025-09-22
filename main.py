import os
import random
import logging
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Dict, Set

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
SIGNALING_SECRET = os.environ.get("SIGNALING_SECRET", "SecretKey123")
TZ = ZoneInfo("Europe/Vilnius")
PORT = int(os.environ.get("PORT", 10000))

# In-memory storage
calls_storage = {}
rooms: Dict[str, Dict[str, WebSocket]] = {}  # room_code -> {peer_id -> websocket}
active_calls: Set[str] = set()  # Активные коды звонков
scheduler = AsyncIOScheduler()
http_session = None
bot_app = None

# Mount WebApp
app.mount("/", StaticFiles(directory="webapp", html=True), name="webapp")


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_code: str, peer_id: str):
        await websocket.accept()

        if room_code not in self.active_connections:
            self.active_connections[room_code] = {}

        self.active_connections[room_code][peer_id] = websocket

        # Уведомляем других участников о новом подключении
        await self.broadcast_to_room(room_code, {
            "type": "new_peer",
            "peer_id": peer_id
        }, exclude_peer=peer_id)

        # Отправляем новому участнику список текущих пиров
        peers = [pid for pid in self.active_connections[room_code].keys() if pid != peer_id]
        await self.send_personal_message({
            "type": "peers",
            "peers": peers
        }, room_code, peer_id)

    def disconnect(self, room_code: str, peer_id: str):
        if room_code in self.active_connections and peer_id in self.active_connections[room_code]:
            del self.active_connections[room_code][peer_id]

            # Если комната пуста, удаляем её
            if not self.active_connections[room_code]:
                del self.active_connections[room_code]

    async def send_personal_message(self, message: dict, room_code: str, peer_id: str):
        if room_code in self.active_connections and peer_id in self.active_connections[room_code]:
            try:
                await self.active_connections[room_code][peer_id].send_json(message)
            except Exception as e:
                logger.error(f"Error sending message to {peer_id}: {e}")

    async def broadcast_to_room(self, message: dict, room_code: str, exclude_peer: str = None):
        if room_code in self.active_connections:
            disconnected = []
            for peer_id, websocket in self.active_connections[room_code].items():
                if peer_id == exclude_peer:
                    continue
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.error(f"Error broadcasting to {peer_id}: {e}")
                    disconnected.append(peer_id)

            # Удаляем отключенные соединения
            for peer_id in disconnected:
                self.disconnect(room_code, peer_id)


manager = ConnectionManager()


# Basic functions
def gen_code():
    return "{:06d}".format(random.randint(0, 999999))


def save_call(code, creator_id, start_ts, duration_min):
    call_id = f"{code}_{datetime.now().timestamp()}"
    calls_storage[call_id] = {
        'code': code,
        'creator_id': creator_id,
        'start_ts': start_ts,
        'duration_min': duration_min,
        'created_ts': int(datetime.now(tz=TZ).timestamp()),
        'active': True
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


def is_call_active(code):
    """Проверяет, активен ли звонок в данный момент"""
    call_data = get_call_by_code(code)
    if not call_data:
        return False

    _, _, _, start_ts, duration_min, active = call_data
    if not active:
        return False

    now = datetime.now(TZ).timestamp()
    call_end_ts = start_ts + (duration_min * 60)

    return start_ts <= now <= call_end_ts


async def check_and_activate_calls():
    """Проверяет и активирует/деактивирует звонки по расписанию"""
    now = datetime.now(TZ)
    current_ts = now.timestamp()

    for call_id, data in calls_storage.items():
        if not data['active']:
            continue

        call_end_ts = data['start_ts'] + (data['duration_min'] * 60)

        # Деактивируем завершенные звонки
        if current_ts > call_end_ts:
            data['active'] = False
            logger.info(f"Call {data['code']} deactivated (ended)")


# Bot handlers
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [[InlineKeyboardButton("Открыть Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]]
    await update.message.reply_text(
        "Привет! Используй команды:\n/create - создать звонок\n/list - мои звонки\n/delete <код> - удалить звонок",
        reply_markup=InlineKeyboardMarkup(kb)
    )


async def create_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Введите время начала (HH:MM):")
    return ASK_TIME


async def create_time_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    time_str = update.message.text.strip()
    try:
        now = datetime.now(TZ)
        dt = datetime.strptime(time_str, "%H:%M").replace(
            year=now.year,
            month=now.month,
            day=now.day,
            tzinfo=TZ
        )
        if dt < now:
            dt += timedelta(days=1)
        context.user_data["call_start_dt"] = dt
        await update.message.reply_text(f"Время: {dt.strftime('%H:%M')}. Введите длительность в минутах:")
        return ASK_DURATION
    except ValueError:
        await update.message.reply_text("Неверный формат. Используйте HH:MM")
        return ASK_TIME


async def create_duration_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        minutes = int(update.message.text.strip())
        if minutes <= 0 or minutes > 1440:  # Максимум 24 часа
            await update.message.reply_text("Длительность должна быть от 1 до 1440 минут")
            return ASK_DURATION

        dt = context.user_data["call_start_dt"]
        code = gen_code()
        call_id = save_call(code, update.message.from_user.id, int(dt.timestamp()), minutes)

        await update.message.reply_text(
            f"✅ Звонок создан!\n"
            f"Код: {code}\n"
            f"Время: {dt.strftime('%Y-%m-%d %H:%M')}\n"
            f"Длительность: {minutes} мин"
        )
        return ConversationHandler.END
    except ValueError:
        await update.message.reply_text("Введите число минут")
        return ASK_DURATION


async def list_calls(update: Update, context: ContextTypes.DEFAULT_TYPE):
    calls = get_user_calls(update.message.from_user.id)
    if not calls:
        await update.message.reply_text("Нет созданных звонков")
        return

    response = "Ваши звонки:\n"
    for code, time, dur, active in calls:
        status = "✅ Активен" if active else "❌ Завершен"
        response += f"• {code} - {time} - {dur} мин - {status}\n"

    await update.message.reply_text(response)


async def delete_call(update: Update, context: ContextTypes.DEFAULT_TYPE):
    parts = update.message.text.split()
    if len(parts) < 2:
        await update.message.reply_text("Использование: /delete <код>")
        return

    code = parts[1].strip()
    row = get_call_by_code(code)
    if not row:
        await update.message.reply_text("Код не найден")
        return

    cid, _, creator_id, _, _, active = row
    if creator_id != update.message.from_user.id:
        await update.message.reply_text("Вы не создатель этого звонка")
        return

    if mark_call_inactive(cid):
        await update.message.reply_text(f"✅ Звонок {code} удален")
    else:
        await update.message.reply_text("❌ Ошибка удаления")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Отменено")
    return ConversationHandler.END


# WebSocket
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    try:
        # Initial handshake
        data = await websocket.receive_json()

        if data.get("type") != "join":
            await websocket.close(code=1008)
            return

        room_code = data.get("code")
        peer_id = data.get("peer_id")
        secret = data.get("secret")

        # Basic validation
        if not room_code or not peer_id:
            await websocket.close(code=1008)
            return

        # Check if call exists and is active
        if not is_call_active(room_code):
            await websocket.send_json({
                "type": "error",
                "message": "Call not found or not active"
            })
            await websocket.close(code=1008)
            return

        await manager.connect(websocket, room_code, peer_id)

        try:
            while True:
                data = await websocket.receive_json()

                # Route signaling messages
                if data.get("type") in ["offer", "answer", "ice"]:
                    target_peer = data.get("target")
                    if target_peer:
                        await manager.send_personal_message(data, room_code, target_peer)

        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            manager.disconnect(room_code, peer_id)
            await manager.broadcast_to_room({
                "type": "peer_left",
                "peer_id": peer_id
            }, room_code)

    except Exception as e:
        logger.error(f"WebSocket connection error: {e}")


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
        logger.error(f"Webhook error: {e}")
        return JSONResponse(status_code=400, content={"status": "error", "message": str(e)})


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.get("/debug")
async def debug():
    return {
        "bot_initialized": bot_app is not None,
        "calls_count": len(calls_storage),
        "active_rooms": len(manager.active_connections),
        "active_calls": len([c for c in calls_storage.values() if c['active']])
    }


@app.get("/call/{code}/status")
async def call_status(code: str):
    call_data = get_call_by_code(code)
    if not call_data:
        return {"active": False, "exists": False}

    _, _, _, start_ts, duration_min, active = call_data
    now = datetime.now(TZ).timestamp()
    call_end_ts = start_ts + (duration_min * 60)

    return {
        "active": active and start_ts <= now <= call_end_ts,
        "exists": True,
        "start_time": start_ts,
        "end_time": call_end_ts,
        "current_time": now
    }


# Startup/shutdown
@app.on_event("startup")
async def on_startup():
    global bot_app, http_session

    if not BOT_TOKEN or not WEBAPP_URL:
        logger.error("Missing environment variables")
        return

    try:
        bot_app = Application.builder().token(BOT_TOKEN).build()
        http_session = ClientSession()

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
        bot_app.add_handler(CommandHandler("delete", delete_call))

        # Setup scheduler for call management
        scheduler.add_job(check_and_activate_calls, 'interval', minutes=1)
        scheduler.start()

        # Set webhook if WEBAPP_URL is provided
        if WEBAPP_URL:
            webhook_url = f"{WEBAPP_URL}/webhook"
            await bot_app.bot.set_webhook(webhook_url)
            logger.info(f"Webhook set to: {webhook_url}")

        logger.info("✅ Bot started successfully")

    except Exception as e:
        logger.error(f"❌ Bot startup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    if bot_app:
        await bot_app.bot.delete_webhook()
        await bot_app.shutdown()
    if http_session:
        await http_session.close()
    scheduler.shutdown()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)