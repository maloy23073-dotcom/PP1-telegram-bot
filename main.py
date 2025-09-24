import os
import logging
import random
import json
from datetime import datetime
from aiogram import Bot, Dispatcher, types
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")

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


# Хранилище для управления соединениями
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}
        self.user_data: dict[str, dict] = {}

    async def connect(self, websocket: WebSocket, room_code: str, user_id: str):
        await websocket.accept()

        if room_code not in self.active_connections:
            self.active_connections[room_code] = []
            self.user_data[room_code] = {}

        self.active_connections[room_code].append(websocket)
        self.user_data[room_code][user_id] = {
            "websocket": websocket,
            "joined_at": datetime.now()
        }

        logger.info(f"User {user_id} joined room {room_code}")

        # Уведомляем других участников о новом пользователе
        await self.notify_users(room_code, {
            "type": "user_joined",
            "user_id": user_id
        }, exclude_user=user_id)

    def disconnect(self, websocket: WebSocket, room_code: str, user_id: str):
        if room_code in self.active_connections:
            if websocket in self.active_connections[room_code]:
                self.active_connections[room_code].remove(websocket)

            if user_id in self.user_data[room_code]:
                del self.user_data[room_code][user_id]

            logger.info(f"User {user_id} left room {room_code}")

            # Если комната пуста, удаляем ее
            if not self.active_connections[room_code]:
                del self.active_connections[room_code]
                del self.user_data[room_code]

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, room_code: str, message: dict):
        if room_code in self.active_connections:
            for connection in self.active_connections[room_code]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"Error sending message: {e}")

    async def notify_users(self, room_code: str, message: dict, exclude_user: str = None):
        if room_code in self.user_data:
            for user_id, data in self.user_data[room_code].items():
                if user_id != exclude_user:
                    try:
                        await data["websocket"].send_json(message)
                    except Exception as e:
                        logger.error(f"Error notifying user {user_id}: {e}")


manager = ConnectionManager()

# Временное хранилище звонков
calls_storage = {}


# Обработчики команд бота
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=WEBAPP_URL))]
    ])
    await message.answer(
        "🎥 **VideoCall Bot**\n\n"
        "Я помогу вам организовать видеозвонки через Telegram!\n\n"
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
    code = ''.join([str(random.randint(0, 9)) for _ in range(6)])

    # Сохраняем в памяти
    calls_storage[code] = {
        'creator_id': message.from_user.id,
        'start_ts': int(datetime.now().timestamp()),
        'active': True
    }

    await message.answer(
        f"✅ **Звонок создан!**\n\n"
        f"🔢 **Код для подключения:** `{code}`\n"
        f"⏰ **Длительность:** 2 часа\n\n"
        f"📱 **Чтобы присоединиться:**\n"
        f"1. Откройте Mini App по кнопке ниже\n"
        f"2. Введите код `{code}`\n"
        f"3. Нажмите 'Подключиться'",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎥 Открыть VideoCall", web_app=WebAppInfo(url=f"{WEBAPP_URL}?code={code}"))]
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
        status = "✅ Активен" if data['active'] else "❌ Завершен"
        response += f"🔢 **Код:** `{code}`\n"
        response += f"⏰ **Время:** {start_time}\n"
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


# WebSocket для WebRTC сигналинга
@app.websocket("/ws/{room_code}/{user_id}")
async def websocket_endpoint(websocket: WebSocket, room_code: str, user_id: str):
    await manager.connect(websocket, room_code, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)

            # Обрабатываем WebRTC сигналы
            if message["type"] == "offer":
                # Пересылаем offer другим участникам
                await manager.notify_users(room_code, {
                    "type": "offer",
                    "offer": message["offer"],
                    "from": user_id
                }, exclude_user=user_id)

            elif message["type"] == "answer":
                # Пересылаем answer отправителю offer
                target_user = message.get("to")
                if target_user and room_code in manager.user_data:
                    if target_user in manager.user_data[room_code]:
                        await manager.send_personal_message({
                            "type": "answer",
                            "answer": message["answer"],
                            "from": user_id
                        }, manager.user_data[room_code][target_user]["websocket"])

            elif message["type"] == "ice_candidate":
                # Пересылаем ICE кандидата
                target_user = message.get("to")
                if target_user and room_code in manager.user_data:
                    if target_user in manager.user_data[room_code]:
                        await manager.send_personal_message({
                            "type": "ice_candidate",
                            "candidate": message["candidate"],
                            "from": user_id
                        }, manager.user_data[room_code][target_user]["websocket"])

            elif message["type"] == "get_users":
                # Отправляем список пользователей в комнате
                if room_code in manager.user_data:
                    users = list(manager.user_data[room_code].keys())
                    await manager.send_personal_message({
                        "type": "users_list",
                        "users": users
                    }, websocket)

    except WebSocketDisconnect:
        manager.disconnect(websocket, room_code, user_id)
        await manager.notify_users(room_code, {
            "type": "user_left",
            "user_id": user_id
        })


# FastAPI endpoints для WebApp
@app.get("/")
async def read_root():
    return FileResponse("static/index.html")


@app.get("/call/{code}/status")
async def call_status(code: str):
    """Проверка активности звонка"""
    if code in calls_storage:
        call = calls_storage[code]
        # Проверяем не истекло ли время (2 часа)
        end_time = call['start_ts'] + (120 * 60)
        current_time = datetime.now().timestamp()
        is_active = call['active'] and current_time <= end_time

        time_left = max(0, end_time - current_time)
        minutes_left = int(time_left // 60)

        return {
            "active": is_active,
            "exists": True,
            "minutes_left": minutes_left
        }
    return {"active": False, "exists": False}


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
    # Устанавливаем вебхук
    webhook_url = f"{WEBAPP_URL}/webhook"
    try:
        await bot.set_webhook(webhook_url)
        logger.info(f"✅ Bot started successfully. Webhook: {webhook_url}")
    except Exception as e:
        logger.error(f"❌ Webhook setup failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)