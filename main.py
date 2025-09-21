import os
import random
import logging
import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from aiohttp import ClientSession
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, Update
from telegram.ext import (
    Application, CommandHandler, MessageHandler, filters,
    ContextTypes, ConversationHandler
)

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
WEBAPP_DIR = os.environ.get("WEBAPP_DIR", "webapp")
app.mount("/", StaticFiles(directory=WEBAPP_DIR, html=True), name="webapp")

# States for ConversationHandler
ASK_TIME, ASK_DURATION = range(2)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")
SIGNALING_SECRET = os.environ.get("SIGNALING_SECRET", "HordownZklord1!2")
TZ = ZoneInfo("Europe/Vilnius")
PORT = int(os.environ.get("PORT", 10000))

# In-memory storage вместо БД
calls_storage = {}

# Глобальные переменные
scheduler = AsyncIOScheduler()
http_session = None
bot_app = None

# rooms: code -> {"participants": {peer_id: websocket}, "lock": asyncio.Lock()}
rooms = {}


# Генерация кода
def gen_code():
    return "{:06d}".format(random.randint(0, 999999))


# Функции работы с хранилищем
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
    logger.info(f"Call saved in memory: {code}")
    return call_id


def get_user_calls(user_id):
    user_calls = []
    for call_id, call_data in calls_storage.items():
        if call_data['creator_id'] == user_id:
            start_dt = datetime.fromtimestamp(call_data['start_ts'], tz=TZ).strftime('%Y-%m-%d %H:%M')
            user_calls.append((
                call_data['code'],
                start_dt,
                call_data['duration_min'],
                call_data['active']
            ))
    return user_calls


def get_call_by_code(code):
    for call_id, call_data in calls_storage.items():
        if call_data['code'] == code:
            return (
                call_id,
                call_data['code'],
                call_data['creator_id'],
                call_data['start_ts'],
                call_data['duration_min'],
                call_data['active']
            )
    return None


def mark_call_inactive(call_id):
    if call_id in calls_storage:
        calls_storage[call_id]['active'] = False
        logger.info(f"Call {call_id} marked as inactive")
        return True
    return False


# Функции планировщика
async def send_5min_warn(call_id, app):
    call_data = calls_storage.get(call_id)
    if not call_data or not call_data['active']:
        return

    code = call_data['code']
    creator_id = call_data['creator_id']

    await app.bot.send_message(
        chat_id=creator_id,
        text=f"Через 5 минут начнётся ваш видеозвонок (код: {code}). Откройте мини-приложение и введите код."
    )


async def end_call_job(call_id, app):
    call_data = calls_storage.get(call_id)
    if not call_data or not call_data['active']:
        return

    code = call_data['code']
    creator_id = call_data['creator_id']

    # Помечаем как неактивный
    mark_call_inactive(call_id)

    # Пытаемся закрыть комнату через API
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
        scheduler.add_job(send_5min_warn, "date", run_date=warn_time, args=[call_id, bot_app])

    end_time = dt + timedelta(minutes=minutes)
    scheduler.add_job(end_call_job, "date", run_date=end_time, args=[call_id, bot_app])

    await update.message.reply_text(
        f"✅ Звонок создан.\nКод: {code}\nДата: {dt.strftime('%Y-%m-%d %H:%M %Z')}\nДлительность: {minutes} мин.\nЗа 5 минут до начала вы получите уведомление.")
    return ConversationHandler.END


async def list_calls(update: Update, context: ContextTypes.DEFAULT_TYPE):
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


# Инициализация при запуске
@app.on_event("startup")
async def on_startup():
    global http_session, bot_app

    logger.info("=== Starting Bot Application ===")

    # Проверяем обязательные переменные окружения
    if not BOT_TOKEN:
        logger.error("❌ BOT_TOKEN environment variable is not set")
        return

    if not WEBAPP_URL:
        logger.error("❌ WEBAPP_URL environment variable is not set")
        return

    logger.info(f"BOT_TOKEN: {'SET' if BOT_TOKEN else 'MISSING'}")
    logger.info(f"WEBAPP_URL: {WEBAPP_URL}")

    try:
        http_session = ClientSession()
        scheduler.start()

        # Создаем приложение бота
        bot_app = Application.builder().token(BOT_TOKEN).build()

        # Добавляем обработчики
        conv = ConversationHandler(
            entry_points=[CommandHandler("create", create_start)],
            states={
                ASK_TIME: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_time_received)],
                ASK_DURATION: [MessageHandler(filters.TEXT & ~filters.COMMAND, create_duration_received)]
            },
            fallbacks=[CommandHandler("cancel", cancel)]
        )

        bot_app.add_handler(CommandHandler("start", start))
        bot_app.add_handler(conv)
        bot_app.add_handler(CommandHandler("list", list_calls))
        bot_app.add_handler(CommandHandler("delete", delete_call))

        logger.info("✅ Bot application created successfully")

        # Установка вебхука
        webhook_url = f"{WEBAPP_URL}/webhook"
        logger.info(f"Setting webhook to: {webhook_url}")

        bot_app.bot.set_webhook(webhook_url)
        logger.info("✅ Webhook set successfully")

        # Проверяем информацию о вебхуке
        webhook_info = await bot_app.bot.get_webhook_info()
        logger.info(f"Webhook info: {webhook_info}")

    except Exception as e:
        logger.error(f"❌ Failed to create bot application: {e}")
        bot_app = None


@app.on_event("shutdown")
async def on_shutdown():
    if bot_app:
        try:
            await bot_app.bot.delete_webhook()
            await bot_app.shutdown()
        except Exception as e:
            logger.error(f"Error during bot shutdown: {e}")

    scheduler.shutdown()

    if http_session:
        await http_session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)