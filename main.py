import os
import psycopg2
from psycopg2.extras import RealDictCursor
import random
import logging
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from aiohttp import ClientSession
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, Update
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler, filters,
    ContextTypes, ConversationHandler
)
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# States for ConversationHandler
ASK_TIME, ASK_DURATION = range(2)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")
SIGNALING_SECRET = os.environ.get("SIGNALING_SECRET", "HordownZklord1!2")
TZ = ZoneInfo("Europe/Vilnius")
PORT = int(os.environ.get("PORT", 10000))


# Инициализация базы данных
def init_db():
    DATABASE_URL = os.environ.get("DATABASE_URL")
    if not DATABASE_URL:
        logger.error("DATABASE_URL environment variable is not set")
        return None

    try:
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
        logger.info("Database connection established successfully")
        return conn
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return None


# Глобальное соединение с БД
DB = init_db()


# Генерация кода
def gen_code():
    return "{:06d}".format(random.randint(0, 999999))


# Функции работы с БД
def save_call(code, creator_id, start_ts, duration_min):
    if not DB:
        logger.error("Database not available")
        return None

    try:
        cur = DB.cursor()
        cur.execute(
            "INSERT INTO calls (code, creator_id, start_ts, duration_min, created_ts) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (code, creator_id, start_ts, duration_min, int(datetime.now(tz=TZ).timestamp()))
        )
        call_id = cur.fetchone()[0]
        DB.commit()
        cur.close()
        logger.info(f"Call saved successfully: {code}")
        return call_id
    except Exception as e:
        logger.error(f"Error saving call: {e}")
        return None


def get_user_calls(user_id):
    if not DB:
        logger.error("Database not available")
        return []

    try:
        cur = DB.cursor()
        cur.execute(
            "SELECT code, start_ts, duration_min, active FROM calls WHERE creator_id = %s ORDER BY start_ts",
            (user_id,)
        )
        rows = cur.fetchall()
        cur.close()

        calls = []
        for code, start_ts, duration_min, active in rows:
            start_dt = datetime.fromtimestamp(start_ts, tz=TZ).strftime('%Y-%m-%d %H:%M')
            calls.append((code, start_dt, duration_min, active))
        return calls
    except Exception as e:
        logger.error(f"Error getting user calls: {e}")
        return []


def get_call_by_code(code):
    if not DB:
        logger.error("Database not available")
        return None

    try:
        cur = DB.cursor()
        cur.execute("SELECT id, code, creator_id, start_ts, duration_min, active FROM calls WHERE code = %s", (code,))
        row = cur.fetchone()
        cur.close()
        return row
    except Exception as e:
        logger.error(f"Error getting call by code: {e}")
        return None


def mark_call_inactive(call_id):
    if not DB:
        logger.error("Database not available")
        return False

    try:
        cur = DB.cursor()
        cur.execute("UPDATE calls SET active = FALSE WHERE id = %s", (call_id,))
        DB.commit()
        cur.close()
        logger.info(f"Call {call_id} marked as inactive")
        return True
    except Exception as e:
        logger.error(f"Error marking call inactive: {e}")
        return False


# Функции планировщика
async def send_5min_warn(call_id, app):
    if not DB:
        logger.error("Database not available - cannot send warning")
        return

    try:
        cur = DB.cursor()
        cur.execute("SELECT code, creator_id, start_ts FROM calls WHERE id = %s AND active = TRUE", (call_id,))
        row = cur.fetchone()
        cur.close()

        if not row:
            return

        code, creator_id, start_ts = row
        await app.bot.send_message(
            chat_id=creator_id,
            text=f"Через 5 минут начнётся ваш видеозвонок (код: {code}). Откройте мини-приложение и введите код."
        )
    except Exception as e:
        logger.error(f"Error sending 5min warning: {e}")


async def end_call_job(call_id, app):
    if not DB:
        logger.error("Database not available - cannot end call")
        return

    try:
        cur = DB.cursor()
        cur.execute("SELECT code, creator_id FROM calls WHERE id = %s AND active = TRUE", (call_id,))
        row = cur.fetchone()
        cur.close()

        if not row:
            return

        code, creator_id = row

        # Сначала помечаем как неактивный в БД
        if mark_call_inactive(call_id):
            # Затем пытаемся закрыть комнату через API
            try:
                async with ClientSession() as session:
                    async with session.post(
                            f"{WEBAPP_URL}/end_room",
                            json={"code": code, "secret": SIGNALING_SECRET},
                            timeout=10
                    ) as response:
                        if response.status != 200:
                            logger.error(f"Failed to end room: {response.status}")
            except Exception as e:
                logger.error(f"Error calling signaling end_room: {e}")

            await app.bot.send_message(
                chat_id=creator_id,
                text=f"Время звонка (код {code}) истекло — комната закрыта."
            )
    except Exception as e:
        logger.error(f"Error in end_call_job: {e}")


# Обработчики команд бота
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    kb = [
        [InlineKeyboardButton("Создать звонок", callback_data="create")],
        [InlineKeyboardButton("Посмотреть созданные", callback_data="list")],
        [InlineKeyboardButton("Удалить звонок ( /delete )", callback_data="delete")],
        [InlineKeyboardButton("Открыть Mini App", web_app=WebAppInfo(url=WEBAPP_URL))]
    ]
    text = "Привет! Я бот для создания видеозвонков. Команды:\n/create — создать\n/list — посмотреть\n/delete <код> — удалить\nТакже можно открыть мини-приложение кнопкой ниже."
    await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(kb))


async def create_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "Укажите время начала звонка в формате `YYYY-MM-DD HH:MM` или `DD.MM.YYYY HH:MM` или просто `HH:MM` (Europe/Vilnius).",
        parse_mode="Markdown")
    return ASK_TIME


def parse_time(text: str):
    text = text.strip()
    formats = ["%Y-%m-%d %H:%M", "%d.%m.%Y %H:%M", "%H:%M"]
    for fmt in formats:
        try:
            dt = datetime.strptime(text, fmt)
            now = datetime.now(tz=TZ)
            if fmt == "%H:%M":
                dt = dt.replace(year=now.year, month=now.month, day=now.day)
                if dt.replace(tzinfo=TZ) < now:
                    dt = dt + timedelta(days=1)
            dt = dt.replace(tzinfo=TZ)
            return dt
        except:
            continue
    return None


async def create_time_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text
    dt = parse_time(text)
    if not dt:
        await update.message.reply_text(
            "Не удалось разобрать время. Используйте формат `YYYY-MM-DD HH:MM` или `DD.MM.YYYY HH:MM` или `HH:MM`.",
            parse_mode="Markdown")
        return ASK_TIME
    context.user_data["call_start_dt"] = dt
    await update.message.reply_text(
        f"Время принято: {dt.strftime('%Y-%m-%d %H:%M %Z')}. Укажите продолжительность звонка в минутах (целое число).")
    return ASK_DURATION


async def create_duration_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    try:
        minutes = int(text)
        if minutes <= 0:
            raise ValueError
    except:
        await update.message.reply_text("Неверный формат. Введите целое число минут.")
        return ASK_DURATION

    dt = context.user_data["call_start_dt"]
    creator = update.message.from_user.id
    code = gen_code()

    # Проверяем уникальность кода
    while get_call_by_code(code):
        code = gen_code()

    call_id = save_call(code, creator, int(dt.timestamp()), minutes)
    if not call_id:
        await update.message.reply_text("❌ Не удалось создать звонок. Попробуйте позже.")
        return ConversationHandler.END

    warn_time = dt - timedelta(minutes=5)

    if warn_time > datetime.now(tz=TZ):
        scheduler.add_job(send_5min_warn, "date", run_date=warn_time, args=[call_id, context.application])

    end_time = dt + timedelta(minutes=minutes)
    scheduler.add_job(end_call_job, "date", run_date=end_time, args=[call_id, context.application])

    await update.message.reply_text(
        f"✅ Звонок создан.\nКод: {code}\nДата: {dt.strftime('%Y-%m-%d %H:%M %Z')}\nДлительность: {minutes} мин.\nЗа 5 минут до начала вы получите уведомление.")
    return ConversationHandler.END


async def list_calls(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not DB:
        await update.message.reply_text("⚠️ База данных временно недоступна. Попробуйте позже.")
        return

    rows = get_user_calls(update.message.from_user.id)
    if not rows:
        await update.message.reply_text("У вас нет созданных звонков.")
        return

    out = "Ваши звонки:\n"
    for code, start, dur, active in rows:
        status = "Активен" if active else "Закрыт"
        out += f"• Код {code} — {start} — {dur} мин — {status}\n"

    await update.message.reply_text(out)


async def delete_call(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not DB:
        await update.message.reply_text("⚠️ База данных временно недоступна. Попробуйте позже.")
        return

    parts = update.message.text.split()
    if len(parts) < 2:
        await update.message.reply_text("Использование: /delete <6-значный код>")
        return

    code = parts[1].strip()
    row = get_call_by_code(code)
    if not row:
        await update.message.reply_text("Код не найден.")
        return

    cid, _, creator_id, _, _, active = row
    if creator_id != update.message.from_user.id:
        await update.message.reply_text("Вы не являетесь создателем этого звонка.")
        return

    if mark_call_inactive(cid):
        try:
            async with ClientSession() as session:
                async with session.post(
                        f"{WEBAPP_URL}/end_room",
                        json={"code": code, "secret": SIGNALING_SECRET},
                        timeout=10
                ) as response:
                    if response.status != 200:
                        logger.error(f"Failed to end room: {response.status}")
        except Exception as e:
            logger.error(f"end_room error: {e}")

        await update.message.reply_text(f"✅ Звонок {code} удалён/закрыт.")
    else:
        await update.message.reply_text("❌ Не удалось удалить звонок. Попробуйте позже.")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Отмена.")
    return ConversationHandler.END


# Создание приложения бота
def build_bot_app():
    app = ApplicationBuilder().token(BOT_TOKEN).build()
    conv = ConversationHandler(
        entry_points=[CommandHandler("create", create_start)],
        states={
            ASK_TIME: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_time_received)],
            ASK_DURATION: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_duration_received)]
        },
        fallbacks=[CommandHandler("cancel", cancel)]
    )
    app.add_handler(CommandHandler("start", start))
    app.add_handler(conv)
    app.add_handler(CommandHandler("list", list_calls))
    app.add_handler(CommandHandler("delete", delete_call))
    return app


# Инициализация FastAPI приложения
app = FastAPI()
WEBAPP_DIR = os.environ.get("WEBAPP_DIR", "webapp")
app.mount("/", StaticFiles(directory=WEBAPP_DIR, html=True), name="webapp")

# rooms: code -> {"participants": {peer_id: websocket}, "lock": asyncio.Lock()}
rooms = {}


# Сигналинг функции
async def broadcast(room_code, message, exclude=None):
    room = rooms.get(room_code)
    if not room:
        return

    async with room["lock"]:
        to_remove = []
        for pid, ws in list(room["participants"].items()):
            if exclude and pid == exclude:
                continue
            try:
                await ws.send_json(message)
            except:
                to_remove.append(pid)

        for pid in to_remove:
            if pid in room["participants"]:
                del room["participants"][pid]
                await broadcast(room_code, {"type": "peer_left", "peer_id": pid})


async def remove_participant(room_code, peer_id):
    room = rooms.get(room_code)
    if not room:
        return

    async with room["lock"]:
        if peer_id in room["participants"]:
            del room["participants"][peer_id]
            await broadcast(room_code, {"type": "peer_left", "peer_id": peer_id})


# WebSocket для сигналинга
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    peer_id = None
    room_code = None

    try:
        while True:
            data = await websocket.receive_json()
            typ = data.get("type")

            if typ == "join":
                room_code = data.get("code")
                peer_id = data.get("peer_id")

                if room_code not in rooms:
                    rooms[room_code] = {"participants": {}, "lock": asyncio.Lock()}

                async with rooms[room_code]["lock"]:
                    rooms[room_code]["participants"][peer_id] = websocket

                existing = [p for p in rooms[room_code]["participants"].keys() if p != peer_id]
                await websocket.send_json({"type": "peers", "peers": existing})
                await broadcast(room_code, {"type": "new_peer", "peer_id": peer_id}, exclude=peer_id)

            elif typ in ("offer", "answer", "ice"):
                target = data.get("target")
                room_code = data.get("code")
                room = rooms.get(room_code)

                if room and target in room["participants"]:
                    try:
                        await room["participants"][target].send_json(data)
                    except:
                        await remove_participant(room_code, target)

            elif typ == "leave":
                room_code = data.get("code")
                peer_id = data.get("peer_id")
                await remove_participant(room_code, peer_id)

    except WebSocketDisconnect:
        if room_code and peer_id:
            await remove_participant(room_code, peer_id)
    except Exception as e:
        logger.error("WS error: %s", e)
        if room_code and peer_id:
            await remove_participant(room_code, peer_id)


# Эндпоинты API
@app.post("/end_room")
async def end_room(request: Request):
    try:
        payload = await request.json()
        if payload.get("secret") != SIGNALING_SECRET:
            raise HTTPException(status_code=403, detail="Forbidden")

        code = payload.get("code")
        if not code:
            return JSONResponse({"ok": False, "reason": "no code"}, status_code=400)

        room = rooms.pop(code, None)
        if room:
            async with room["lock"]:
                for pid, ws in list(room["participants"].items()):
                    try:
                        await ws.send_json({"type": "room_closed"})
                        await ws.close()
                    except:
                        pass

        return {"ok": True}
    except Exception as e:
        logger.error(f"Error in end_room: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/ping")
async def ping():
    return {"ok": True}


# Вебхук для бота
@app.post("/webhook")
async def webhook(request: Request):
    try:
        data = await request.json()
        update = Update.de_json(data, bot_app.bot)
        await bot_app.update_queue.put(update)
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Error processing update: {e}")
        return {"status": "error", "message": str(e)}


# Инициализация глобальных переменных
scheduler = AsyncIOScheduler()
http_session = None
bot_app = None


# Инициализация при запуске
@app.on_event("startup")
async def on_startup():
    global http_session, bot_app

    # Проверяем обязательные переменные окружения
    required_vars = ["BOT_TOKEN", "WEBAPP_URL", "DATABASE_URL"]
    for var in required_vars:
        if not os.environ.get(var):
            logger.error(f"Missing required environment variable: {var}")

    http_session = ClientSession()
    scheduler.start()
    bot_app = build_bot_app()

    # Инициализация таблицы если БД доступна
    if DB:
        try:
            cur = DB.cursor()
            cur.execute("""
                        CREATE TABLE IF NOT EXISTS calls
                        (
                            id
                            SERIAL
                            PRIMARY
                            KEY,
                            code
                            VARCHAR
                        (
                            6
                        ) UNIQUE NOT NULL,
                            creator_id BIGINT NOT NULL,
                            start_ts INTEGER NOT NULL,
                            duration_min INTEGER NOT NULL,
                            created_ts INTEGER NOT NULL,
                            active BOOLEAN DEFAULT TRUE
                            )
                        """)
            DB.commit()
            cur.close()
            logger.info("Database table initialized successfully")
        except Exception as e:
            logger.error(f"Error initializing database: {e}")
    else:
        logger.warning("Database not available - skipping table initialization")

    # Установка вебхука
    webhook_url = f"{WEBAPP_URL}/webhook"
    try:
        await bot_app.bot.set_webhook(webhook_url)
        logger.info("Webhook set to: %s", webhook_url)
    except Exception as e:
        logger.error(f"Failed to set webhook: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    if bot_app:
        await bot_app.bot.delete_webhook()
        await bot_app.shutdown()

    scheduler.shutdown()

    if http_session:
        await http_session.close()

    if DB:
        DB.close()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)