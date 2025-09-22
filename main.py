import os
import logging
from fastapi import FastAPI, Request
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
BOT_TOKEN = os.environ.get("BOT_TOKEN")
WEBAPP_URL = os.environ.get("WEBAPP_URL")


@app.on_event("startup")
async def on_startup():
    logger.info("=== Starting Application ===")
    logger.info(f"BOT_TOKEN: {'SET' if BOT_TOKEN else 'MISSING'}")

    # Проверяем импорт ДО создания бота
    try:
        from telegram.ext import Application
        logger.info("✅ Telegram imports successful")

        if BOT_TOKEN:
            bot_app = Application.builder().token(BOT_TOKEN).build()
            logger.info("✅ Bot application created")

            if WEBAPP_URL:
                await bot_app.bot.set_webhook(f"{WEBAPP_URL}/webhook")
                logger.info("✅ Webhook set")
            else:
                logger.warning("WEBAPP_URL not set")
        else:
            logger.error("BOT_TOKEN not set")

    except Exception as e:
        logger.error(f"❌ Import/creation failed: {e}")
        import traceback
        logger.error(traceback.format_exc())


@app.post("/webhook")
async def webhook(request: Request):
    return {"status": "ok", "message": "Webhook received"}


@app.get("/ping")
async def ping():
    return {"ok": True}


@app.get("/")
async def root():
    return {"message": "Server is running"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=10000)