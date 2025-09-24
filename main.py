import os
import logging
import asyncio
from datetime import datetime, timedelta
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import WebAppInfo, InlineKeyboardButton, InlineKeyboardMarkup
from fastapi import FastAPI, Request
import psycopg2
from psycopg2.extras import RealDictCursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")
DATABASE_URL = os.environ.get("DATABASE_URL")

if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN environment variable is required!")
if not WEBAPP_URL:
    raise ValueError("WEBAPP_URL environment variable is required!")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is required!")

# Инициализация бота
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# Инициализация FastAPI
app = FastAPI()


# Подключение к PostgreSQL
def get_db_connection():
    """Подключение к базе данных"""
    try:
        # Для Render.com PostgreSQL
        conn = psycopg2.connect(DATABASE_URL, sslmode='require')
        return conn
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        raise


# Обработчики команд
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
    import random

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Генерируем уникальный 6-значный код
        max_attempts = 10
        code = None

        for attempt in range(max_attempts):
            code = ''.join([str(random.randint(0, 9)) for _ in range(6)])

            # Проверяем, что код уникален
            cur.execute("SELECT code FROM calls WHERE code = %s", (code,))
            if not cur.fetchone():
                break
        else:
            await message.answer("❌ **Не удалось создать уникальный код**\nПопробуйте еще раз.", parse_mode="Markdown")
            cur.close()
            conn.close()
            return

        start_ts = int(datetime.now().timestamp())
        created_ts = start_ts

        cur.execute(
            "INSERT INTO calls (code, creator_id, start_ts, duration_min, created_ts, active) VALUES (%s, %s, %s, %s, %s, %s)",
            (code, message.from_user.id, start_ts, 120, created_ts, True)
        )
        conn.commit()

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

        cur.close()
        conn.close()

    except Exception as e:
        logger.error(f"Error creating call: {e}")
        await message.answer("❌ **Ошибка при создании звонка**\nПопробуйте еще раз позже.", parse_mode="Markdown")


@dp.message(Command("list"))
async def cmd_list(message: types.Message):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            "SELECT code, start_ts, duration_min, active FROM calls WHERE creator_id = %s ORDER BY created_ts DESC",
            (message.from_user.id,)
        )
        calls = cur.fetchall()

        if not calls:
            await message.answer("📭 **У вас нет созданных звонков**\n\nИспользуйте /create чтобы создать первый звонок",
                                 parse_mode="Markdown")
            cur.close()
            conn.close()
            return

        response = "📞 **Ваши активные звонки:**\n\n"
        for call in calls:
            code, start_ts, duration, active = call
            start_time = datetime.fromtimestamp(start_ts).strftime('%d.%m.%Y %H:%M')
            status = "✅ Активен" if active else "❌ Завершен"
            response += f"🔢 **Код:** `{code}`\n"
            response += f"⏰ **Время:** {start_time}\n"
            response += f"⏱️ **Длительность:** {duration} мин\n"
            response += f"📊 **Статус:** {status}\n\n"

        await message.answer(response, parse_mode="Markdown")
        cur.close()
        conn.close()

    except Exception as e:
        logger.error(f"Database error in /list: {e}")
        await message.answer("❌ **Ошибка при получении списка звонков**", parse_mode="Markdown")


@dp.message(Command("delete"))
async def cmd_delete(message: types.Message):
    args = message.text.split()
    if len(args) < 2:
        await message.answer("❌ **Использование:**\n`/delete <код_звонка>`\n\nПример: `/delete 123456`",
                             parse_mode="Markdown")
        return

    code = args[1]
    if not code.isdigit() or len(code) != 6:
        await message.answer("❌ **Код должен состоять из 6 цифр**", parse_mode="Markdown")
        return

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM calls WHERE code = %s AND creator_id = %s", (code, message.from_user.id))
        conn.commit()

        if cur.rowcount > 0:
            await message.answer(f"✅ **Звонок {code} удален**", parse_mode="Markdown")
        else:
            await message.answer("❌ **Звонок не найден или у вас нет прав для его удаления**", parse_mode="Markdown")

        cur.close()
        conn.close()

    except Exception as e:
        logger.error(f"Database error in /delete: {e}")
        await message.answer("❌ **Ошибка при удалении звонка**", parse_mode="Markdown")


# FastAPI endpoints для WebApp
@app.get("/")
async def read_root():
    return {"message": "VideoCall Bot API", "status": "running"}


@app.get("/call/{code}/status")
async def call_status(code: str):
    """Проверка активности звонка"""
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT active, start_ts, duration_min FROM calls WHERE code = %s", (code,))
        call = cur.fetchone()
        cur.close()
        conn.close()

        if call:
            # Проверяем не истекло ли время звонка
            end_time = call['start_ts'] + (call['duration_min'] * 60)
            current_time = datetime.now().timestamp()
            is_active = call['active'] and current_time <= end_time

            time_left = max(0, end_time - current_time)
            minutes_left = int(time_left // 60)

            return {
                "active": is_active,
                "exists": True,
                "minutes_left": minutes_left,
                "valid_until": datetime.fromtimestamp(end_time).isoformat()
            }
        return {"active": False, "exists": False}
    except Exception as e:
        logger.error(f"Call status error: {e}")
        return {"active": False, "exists": False}


@app.post("/call/{code}/join")
async def join_call(code: str):
    """Регистрация участника звонка"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("UPDATE calls SET active = TRUE WHERE code = %s", (code,))
        conn.commit()
        cur.close()
        conn.close()
        return {"success": True}
    except Exception as e:
        logger.error(f"Join call error: {e}")
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

    # Инициализация базы данных
    try:
        conn = get_db_connection()
        cur = conn.cursor()
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
        conn.commit()
        cur.close()
        conn.close()
        logger.info("✅ Database initialized")
    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")


@app.on_event("shutdown")
async def on_shutdown():
    await bot.session.close()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=10000)